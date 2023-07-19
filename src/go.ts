import { Mutex } from 'async-mutex'
import chalk from 'chalk';

import * as child_process from 'child_process'
import * as fs from 'fs'
import YAML from 'yaml'

import { AwareChat, getInputPrompt } from './openai'

import { promisify } from 'util'
import { chomp } from '@rauschma/stringio'
import { streamWrite, onExit } from '@rauschma/stringio'
import combineAsyncIterators from 'combine-async-iterators'
const sleep = promisify(setTimeout)
const EOL = '\n'

export interface CliReaderProps {
  verbose: number
  command: string
  params: string[]
  settings?: Record<string, boolean | string | null>
  job: {
    command: string
    params: string[]
    context: string
    conclusion?: string
    output_instructions?: string
    robot?: {
      prompts: string[]
      attention: string[]
    }
  }
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
  awareChat: AwareChat
  verbose: number
  logger: {
    VERBOSE_LEVEL: number
    log: (...args: string[]) => void
    warn: (...args: string[]) => void
    info: (...args: string[]) => void
    debug: (...args: string[]) => void
  }

  constructor(private params: CliReaderProps) {
    this.verbose = params.verbose
    this.mutex = new Mutex()
    this.pendingAnswerLock = new Mutex()
    this.logger = {
      VERBOSE_LEVEL: params.verbose,
      log: (...args: string[]) => console.log.apply(console, args),
      warn: (...args: string[]) => {
        params.verbose >= 0 && console.log.apply(console, args)
      },
      info: (...args: string[]) => {
        params.verbose >= 1 && console.log.apply(console, args)
      },
      debug: (...args: string[]) => {
        params.verbose >= 2 && console.log.apply(console, args)
      },
    }
    this.logger.debug(chalk.blue(params.command, params.params?.join(' ')))
  }

  async writeToWritable(what: string): Promise<any> {
    this.logger.warn(chalk.blue(`[INPUT] "${chomp(what)}"`))
    return streamWrite(this.child_process!.stdin, what)
  }

  async *healthCheckPing(interval: number) {
    while (!this.wereDoneReadingStdin) {
      await sleep(interval) // our checkpoint interval
      this.lastTickCheck = Date.now()
      const diff = this.lastTickCheck - this.lastAnswerTime
      // this.logger.debug(diff)
      if (diff > interval) {
        // Hit enter to keep the process flowing
        this.logger.debug('[INFO] ENTER')
        if (this.params?.settings?.hitEnterWhenNoStdout) {
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

    for await (const chunk of chunks) {
      // this.logger.debug('Waiting for mutex')
      // there's a new chunk of data in the stream
      // must wait for the mutex to be unlocked
      await this.mutex.waitForUnlock()

      previous += chunk

      this.logger.debug('chunk', chunk.toString())

      // strip away the color of the terminal
      // along any unicode characters
      let clean = chunk
        .toString()
        .replace(/\x1B[[(?);]{0,2}(;?\d)*./g, '')
        .replace(/[\x00-\x08\x0E-\x1F\x7F-\uFFFF]/g, '')

      let lines = clean.split(EOL).map((l: string) => chomp(l.trim()))

      // this.logger.debug('clean line', lines)

      while (lines.length > 0) {
        const line = lines.shift()
        if (line) {
          const lookupKeys = this.params.job?.robot?.attention || []
          // this.logger.debug('lookupKeys: ', lookupKeys)

          const lookUpIndex = lookupKeys.findIndex((p) => line.indexOf(p) > -1)

          if (lookUpIndex) {
            const lookUpValue = lookupKeys[lookUpIndex]
            this.logger.debug(chalk.gray('[ATTN] 👀 ', lookUpValue))
            // Send the full line to the chat
            await this.awareChat.chat(
              `Mind the following log content for futher reference: ${lookUpIndex} = ${line.substring(
                lookUpIndex
              )}`
            )
          }

          // @to-do this is a hacky way to detect a question and answer
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
          const exitOnMatch =
            typeof this.params?.settings?.exitOnMatch === 'string' &&
            this.params?.settings?.exitOnMatch !== ''
          if (
            exitOnMatch &&
            line.indexOf(this.params?.settings?.exitOnMatch) > -1
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

  async processCommand() {
    const { settings, job } = this.params
    const { params } = this

    this.child_process = child_process.spawn(params.command, params.params, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // this.logger.debug('Settings', settings)
    this.logger.debug('Context', job.context)

    let response = {}

    // We should check if chatgpt is enabled here
    try {
      response = await getInputPrompt(job.context)
    } catch (error:any) {
      if (error?.response) {
        this.logger.debug(error?.response?.status)
        this.logger.debug(error?.response?.data)
      } else {
        this.logger.debug(error?.message)
      }
      return null
    }

    // this.logger.debug(chalk.yellow(response?.content))

    this.awareChat = new AwareChat(
      `The following is a valid JSON output. 
      ${JSON.stringify(response?.content)}
      `
    )

    // ---

    const prompts: string[] | { name: string; value: string }[] =
      job?.robot?.prompts || []

    const iterators = combineAsyncIterators(
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

      const prompt:
        | string
        | {
          name: string
          value?: string | undefined
          hidden?: boolean
        } = prompts[promptIndex]

      if (typeof prompt == 'object') {
        delete prompts[promptIndex]

        let answer = ''

        // this.logger.debug('[PROMPT] ❔', prompt?.name)
        // we have a defined answer, let's use it
        if (prompt?.value) {
          answer = prompt?.value
          await this.awareChat.chat(
            `Please mind when asked to ${ll}, the answer will be "${answer}"`
          )
        } else {
          if (prompt?.skip) {
            answer = ''
          } else {
            answer = (await this.awareChat.chat(prompt?.name)) ?? ''
          }
        }

        const hidden = prompt?.hidden !== undefined
        await this.handlePrompt(prompt?.name, answer, hidden)
      }

      this.lastOutputTime = ll
    }

    if (job.conclusion && job.conclusion !== '') {
      const conclusion = await this.awareChat.chat(job.conclusion)
      this.logger.debug('Conclusion: \n', conclusion ?? '')
    }

    // Print the output of the job if any
    if (job.output_instructions && job.output_instructions !== '') {
      const output = await this.awareChat.chat(job.output_instructions)
      this.logger.log(output ?? '')
    }

    // It is important to wait for the process to exit
    await onExit(this.child_process)
  }

  async handlePrompt(question: string, answer: string, hidden?: boolean) {
    this.logger.warn(chalk.yellow(`[QUESTION] ${question}`))
    this.lastQuestion = question
    await this.mutex.acquire()
    // this.logger.debug(`[PROMPT] ${question}`)
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

/**
 * Default handler
 * @param seed
 */
export async function handler({
  file,
  seed,
  verbose,
}: {
  file?: string
  seed: string
  verbose?: number
}): Promise<void> {
  const VERBOSE_LEVEL = verbose || 0

  const config_file_content = readConfigFile(file);

  const { jobs } = YAML.parse(config_file_content)

  const job = jobs.find((j: any) => j?.id === seed)

  if (!job) {
    console.log(`No job found for ${seed}`)
    process.exit(1)
  }

  const settings: Record<string, boolean> = job?.settings?.reduce((acc, s) => {
    if (typeof s.value === 'boolean') {
      acc[s.name] = s.value
    } else if (typeof s.value === 'string') {
      if (s.value === 'true' || s.value === 'false') {
        // string boolean
        acc[s.name] = s.value && s.value !== 'false'
      } else {
        acc[s.name] = s.value
      }
    }
    return acc
  }, {})


  const { command, params } = job
  const cli = new CliReader({
    command,
    params,
    settings,
    job,
    verbose: VERBOSE_LEVEL,
  })

  await cli.processCommand()
}

function readConfigFile(file: string | undefined) {
  const config_file = file ?? 'input.yaml';
  const config_file_abs = `${process.cwd()}/${config_file}`;

  if (!fs.existsSync(config_file_abs)) {
    console.log(`Config file not found in ${config_file_abs}`);
    process.exit(1);
  }

  const config_file_content = fs.readFileSync(config_file_abs, 'utf8');
  return config_file_content;
}

