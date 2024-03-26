import { Mutex } from 'async-mutex';
import chalk from 'chalk';
import * as fs from 'fs';

import * as child_process from 'child_process';

import { AwareChat, getInputPrompt } from '../ai/openai';

import { chomp, onExit, streamWrite } from '@rauschma/stringio';
import combineAsyncIterators from 'combine-async-iterators';
import { promisify } from 'util';
import { JobItem, Prompt } from '../types';
import { removeUnicode } from './utils';
import { isString } from '../utils/safeguards';
const sleep = promisify(setTimeout)
const EOL = '\n'

export function readConfigFile(file: string | undefined) {
    const config_file = file ?? 'input.yaml';
    const config_file_abs = `${process.cwd()}/${config_file}`;

    if (!fs.existsSync(config_file_abs)) {
        console.log(`Config file not found in ${config_file_abs}`);
        process.exit(1);
    }

    const config_file_content = fs.readFileSync(config_file_abs, 'utf8');
    return config_file_content;
}

export interface CliReaderProps {
    verbose: number
    // command: string
    // params: string[]
    // settings?: Record<string, boolean | string | null>
    job: JobItem
}
export class CliReader {
    wereDoneReadingStdin: boolean = false
    lastTickCheck: number | undefined = 0
    child_process: child_process.ChildProcess | null = null
    lastOutputTime: string = '-'
    lastOutput: string = ''
    lastQuestion: string = ''
    lastAnswer: string = ''
    lastAnswerTime: number = 0
    mutex: any
    pendingAnswerLock: any
    enableGpt: boolean = false
    awareChat: AwareChat | null = null
    verbose: number
    logger: {
        VERBOSE_LEVEL: number
        log: (...args: string[]) => void
        warn: (...args: string[]) => void
        info: (...args: string[]) => void
        debug: (...args: string[]) => void
    }

    constructor(private params: CliReaderProps) {

        const { command, params: jobParams } = params.job.job

        this.verbose = params.verbose
        this.mutex = new Mutex()
        this.pendingAnswerLock = new Mutex()
        this.logger = createLogger(this.verbose)
        this.logger.debug(chalk.blue(command, jobParams?.join(' ')))
    }

    async writeToWritable(what: string): Promise<any> {
        this.logger.warn(chalk.blue(`[INPUT] "${chomp(what)}"`))
        if (this.child_process && this.child_process.stdin) {
            return streamWrite(this.child_process.stdin, what)
        }
    }

    async *healthCheckPing(interval: number) {
        const settings = this.params.job.settings || {}
        while (!this.wereDoneReadingStdin) {
            await sleep(interval) // our checkpoint interval
            this.lastTickCheck = Date.now()
            const diff = this.lastTickCheck - this.lastAnswerTime
            // this.logger.debug(diff)
            if (diff > interval) {
                // Hit enter to keep the process flowing
                this.logger.debug('[INFO] ENTER')
                if (settings?.hitEnterWhenNoStdout) {
                    await this.answer(EOL)
                }
            }
            yield null
        }
    }

    /**
     * Parameter: async iterable of chunks (strings)
     * Result: async iterable of lines (incl. newlines)
     */
    async *chunksPromptsToLinesAsync(
        chunks: AsyncIterable<string>
    ): AsyncIterable<string> {
        if (!Symbol.asyncIterator) {
            throw new Error(
                'Current JavaScript engine does not support asynchronous iterables'
            )
        }
        if (!(Symbol.asyncIterator in chunks)) {
            throw new Error('Parameter is not an asynchronous iterable')
        }
        let previous = ''

        const settings = this.params.job.settings
        const exitOnMatch = settings.exitOnMatch
        const exitOnMatchIsString = isString(exitOnMatch)

        for await (const chunk of chunks) {
            // this.logger.debug('Waiting for mutex')
            // there's a new chunk of data in the stream
            // must wait for the mutex to be unlocked
            await this.mutex.waitForUnlock()

            previous += chunk

            // this.logger.debug('chunk', chunk.toString())

            // strip away the color of the terminal
            // along any unicode characters
            let clean = removeUnicode(chunk.toString())

            let lines = clean.split(EOL).map((l: string) => chomp(l.trim()))

            while (lines.length > 0) {
                const line = lines.shift()
                if (line && line.length > 0) {
                    const lookupKeys = this.params.job.job?.interaction?.attention || []
                    // this.logger.debug('lookupKeys: ', lookupKeys)

                    const lookUpIndex = lookupKeys.findIndex((p) => line.indexOf(p) > -1)

                    if (lookUpIndex > -1) {
                        const lookUpValue = lookupKeys[lookUpIndex]
                        this.logger.debug(chalk.gray('[ATTN] 👀 ', lookUpValue))
                        // Send the full line to the chat
                        await this.chat(
                            `Mind the following log content for futher reference: ${lookUpIndex} = ${line.substring(
                                lookUpIndex
                            )}`
                        )
                    }

                    // @to-do this is a hacky way to detect a question and answer
                    // we should use a proper NLP library to detect questions or AI
                    if (
                        this.lastQuestion !== '' &&
                        this.lastAnswer !== '' &&
                        line.indexOf(this.lastQuestion) === 0 &&
                        line.endsWith(this.lastAnswer)
                    ) {
                        this.logger.debug('[ACK]', this.lastQuestion, this.lastAnswer)
                        await this.pendingAnswerLock.release()
                        continue
                    }
                    yield line

                    // This setting allow to stop the process when a certain string is found
                    if (
                        exitOnMatch &&
                        exitOnMatchIsString &&
                        line.indexOf(exitOnMatch) > -1
                    ) {
                        // this.logger.debug('exitOnMatch', this.params?.settings?.exitOnMatch)
                        this.logger.warn('The process will be terminated now.')
                        this.child_process?.kill()
                        continue
                    }
                }
            }
        }
        if (previous.length > 0) {
            yield previous
        }
        // there will be no more data in the stream
        this.wereDoneReadingStdin = true
    }
    chat(arg0: string) {
        if (!this.enableGpt) {
            this.logger.warn('GPT is not enabled')
            return
        }
        if (!this.awareChat) {
            this.logger.warn('awareChat is not initialized')
            return
        }
        return this.awareChat.chat(arg0)
    }

    async processCommand() {
        const { params } = this
        const { job: jobItem } = this.params
        const { job } = jobItem

        this.child_process = child_process.spawn(job.command, job.params, {
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe'],
        })

        this.child_process.stdout?.pipe(process.stdout);
        this.child_process.stderr?.pipe(process.stderr);
        
        this.child_process.on('close', (code) => {
            console.log(`child process exited with code ${code}`);
          }); 

        this.child_process.on('error', () => {
            this.logger.debug(chalk.yellow(`[ERROR]`))
        })
        
        this.child_process.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
            this.logger.debug(chalk.yellow(`[EXIT] ${code}`))
        })

        let response = {}

        if (typeof job.context == 'string' && job.context !== '') {
            // this.logger.debug('Settings', settings)
            this.logger.debug('Context', job.context)
            // We should check if chatgpt is enabled here
            try {
                const inputResponse = await getInputPrompt(job.context)
                if (typeof inputResponse == 'string') {
                    response = inputResponse
                } else if (typeof inputResponse == 'object') {
                    response = inputResponse?.content ?? ''
                }
            } catch (error: any) {
                if (error?.response) {
                    this.logger.debug(error?.response?.status)
                    this.logger.debug(error?.response?.data)
                } else {
                    this.logger.debug(error?.message)
                }
                return null
            }

            // this.logger.debug(chalk.yellow(response?.content))
            // this.awareChat = new AwareChat(
            // `The following is a valid JSON output. 
            //   ${JSON.stringify(response?.content)}
            // `
            // )
        }

        // ---

        const prompts: Prompt[] = job?.interaction?.prompts || []

        const iterators = combineAsyncIterators(
            // @ts-ignore - this is a valid async iterator
            this.chunksPromptsToLinesAsync(this.child_process.stdout),
            this.healthCheckPing(3000)
        )

        for await (const line of iterators) {
            // Don't read until lock is released
            await this.mutex.waitForUnlock()
            await this.pendingAnswerLock.waitForUnlock()

            if (line === null) {
                // some of the iterators returned nil, not interested
                continue
            }

            if (line === this.lastAnswer) {
                this.logger.debug('SKIP answer output')
                continue
            }

            const ll = chomp(line.toString())

            this.logger.debug('[DEBUG]', chalk.gray(ll))

            if (ll === this.lastOutput) {
                // Prevent stdin overflowing
                this.logger.debug('[WAITING]')
                continue
            }

            // Check if there's a prompt we need to interact with
            const promptIndex: number | null = prompts.findIndex(
                (p: string | { name: string; value: string }) => {
                    return ll.indexOf(typeof p == 'string' ? p : p?.name) > -1
                }
            )

            const prompt = prompts[promptIndex]

            if (typeof prompt == 'object') {
                delete prompts[promptIndex]

                let answer = ''

                this.logger.debug('[PROMPT] ❔', prompt?.name)
                // we have a defined answer, let's use it
                if (prompt?.value) {
                    answer = prompt?.value
                    await this.chat(
                        `Please mind when asked to ${ll}, the answer will be "${answer}"`
                    )
                } else {
                    if (prompt?.skip) {
                        answer = ''
                    } else {
                        // @todo cast properly
                        // @ts-ignore
                        answer = (await this.chat(prompt?.name)) ?? ''
                    }
                }

                const hidden = prompt?.hidden !== undefined
                await this.handlePrompt(prompt?.name, answer, hidden)
            }

            this.lastOutputTime = ll
        }

        if (job.conclusion && job.conclusion !== '') {
            const conclusion = await this.chat(job.conclusion)
            // this.logger.debug('Conclusion: \n', conclusion ?? '')
        }

        // Print the output of the job if any
        if (job.output_instructions && job.output_instructions !== '') {
            const output = await this.chat(job.output_instructions)
            // this.logger.log(output ?? '')
        }

        // It is important to wait for the process to exit
        await onExit(this.child_process)

        
    }

    async handlePrompt(question: string, answer: string, hidden?: boolean) {
        this.logger.warn(chalk.yellow(`[QUESTION] ${question} `))
        this.lastQuestion = question
        await this.mutex.acquire()
        // this.logger.debug(`[PROMPT] ${ question } `)
        // await sleep(1000)
        await this.answer(answer, hidden)
        // The answer is sent, we can release the lock
        this.mutex.release()
    }
    async answer(answer: string, hidden?: boolean) {
        if (answer && answer !== EOL) {
            // We expect to see the answer in the output later
            // const fmt = chomp(String(answer))
            await this.pendingAnswerLock.acquire()
        }
        this.lastAnswer = answer
        this.lastAnswerTime = Date.now()

        await this.writeToWritable(answer + EOL)

        if (hidden) {
            // The answer is hidden from the terminal so there is nothing to wait for
            await this.pendingAnswerLock.release()
        }
    }
}

function createLogger(verbose: number): { VERBOSE_LEVEL: number; log: (...args: string[]) => void; warn: (...args: string[]) => void; info: (...args: string[]) => void; debug: (...args: string[]) => void; } {
    return {
        VERBOSE_LEVEL: verbose,
        log: (...args: string[]) => console.log.apply(console, args),
        warn: (...args: string[]) => {
            verbose >= 0 && console.log.apply(console, args)
        },
        info: (...args: string[]) => {
            verbose >= 1 && console.log.apply(console, args)
        },
        debug: (...args: string[]) => {
            verbose >= 2 && console.log.apply(console, args)
        },
    }
}
