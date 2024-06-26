import { chomp } from '@rauschma/stringio';
import { Mutex } from 'async-mutex';
import chalk from 'chalk';
import * as child_process from 'child_process';
import { emitKeypressEvents } from 'node:readline';
import { ChatCompletionRequestMessageFunctionCall } from 'openai';
import { FN_PARSE_PROMPT, FN_PARSE_PROMPT_AND_SUGGESTION, FN_PARSE_PROMPT_AND_SUGGESTION_ASSISTANT_CONTEXT, invokeFunction } from '../ai/functions';
import { AwareChat, IOpenAiChannel, isChatCompletionResponseMessage } from '../ai/openai';
import { removeUnicode } from '../io/utils';
import { writeYaml } from '../io/yamlWritter';
import { IoRecord, Job, Prompt, PromptWithInfo, ProvidedInput, SkippedInput } from '../types';
import { toCamelCase } from '../utils/strings';
import { EOL } from 'os';
import { promptTemplates } from '../io/promptTemplates';
import { assert } from 'node:console';

const getSubstringsByMask = require('get-substrings-by-mask');

type Io = 'input' | 'output'

interface RecordHistory {
    history: IoRecord[]
    job: Job
}
/**
 * LLM section
 */
export const COMMAND_CLI_APP = 'You are an assistant that captures the input and output of a command line application for later replay. ' +
    'Mind some input prompts contain a default value, which is the value that will be used if the user just presses enter. ' +
    'Sometimes the default value appears between parenthesis, sometimes it is prefixed with a colon. ' +
    'Mind some outputs are not captured, such as the output of the command itself.'

/**
 * This class reads stdin and stdout of a command and records the input and output
 */
export class CliLearnObserver implements IOpenAiChannel {
    keybuffer: string[] = []
    promptsTimeline: Record<number, any> = {}
    inputTimeline: Record<number, number[]> = {}
    outputTimeline: Record<number, string> = {}
    child_process: any
    connectedAt: number | undefined;
    lastOutputAt: number = 0;
    mutex: {
        [key: string]: Mutex
    };
    input: Record<string, string>;
    gptChat: AwareChat;
    questionTrace: boolean = false;
    lastPromptKey: string = '';
    aiEnabled: boolean = false;

    constructor(private args: string[], input?: string[], private options?: {
        aiEnabled?: boolean
        beforeExit?: (history: RecordHistory, promptsTimeline: Record<number, any>) => void
    }) {
        this.mutex = {
            default: new Mutex(),
            traceWindow: new Mutex(),
            stdout: new Mutex()
        }
        this.input = this.parseCliInput(input ?? [])
        this.gptChat = new AwareChat({
            systemContext: COMMAND_CLI_APP,
            messages: [
                {
                    role: 'system',
                    content: FN_PARSE_PROMPT_AND_SUGGESTION_ASSISTANT_CONTEXT,
                },
                {
                    role: 'system',
                    content: `The following is a JSON representation of the input provided by the user: ${JSON.stringify(this.input, null, 2)}}`,
                }
            ],
            openAiSettings: {
                functions: [FN_PARSE_PROMPT_AND_SUGGESTION, FN_PARSE_PROMPT],
                function_call: 'auto',
            }
        })
        // console.log('this.input', this.input)
    }

    private parseCliInput(input: string[]): Record<string, string> {
        return input.reduce((acc: any, s: any) => {
            const values = s.split('=')
            const zero = toCamelCase(values[0])
            if (values.length === 1) {
                acc[values[0]] = '\n'
            }
            if (values.length === 2) {
                acc[zero] = values[1]
                acc[values[0]] = values[1]
            }
            return acc
        }, {})
    }

    lock(key: string): void {
        this.mutex[key].acquire()
    }
    release(key: string): void {
        this.mutex[key].release()
    }

    async observe() {

        const isRawMode = process.stdin.isTTY
        const command = this.args[0]

        if (!command) {
            console.error('No command given')
            process.exit(1)
        }

        const child = child_process.spawn(command, this.args.slice(1))

        child.stdout.on('connection', () => {
            this.connectedAt = Date.now()
        })

        child.stdout.pipe(process.stdout);
        child.stderr.pipe(process.stderr);
        emitKeypressEvents(process.stdin);
        // only available when the input is provided by a TTY
        isRawMode && process.stdin.setRawMode(isRawMode);
        process.stdin.on('keypress', this.handleKeypress.bind(this))
        process.stdin.pipe(child.stdin);

        child.on('exit', () => {
            this.beforeExit()
        })

        this.child_process = child
        const iterator = this.chunksPromptsToLinesAsync(this.child_process.stdout)

        for await (const line of iterator) {
            this.processStdoutChunk(line)
        }

        this.beforeExit()
    }

    beforeExit() {
        const history = this.dumpHistory()
        this.options?.beforeExit?.(history, this.promptsTimeline)
        // write to file
        const fileName = `${process.cwd()}/axo.yaml`;
        this.writeAxoFile(fileName, history);
        // end gracefully
        // process.exit()
    }

    private writeAxoFile(fileName: string, history: RecordHistory) {
        writeYaml(fileName, { jobs: [history.job] });
    }

    async *chunksPromptsToLinesAsync(
        chunks: AsyncIterable<string>
    ): AsyncIterable<string> {
        if (!(Symbol.asyncIterator in chunks)) {
            throw new Error('Parameter is not an asynchronous iterable')
        }
        let previous = ''

        for await (const chunk of chunks) {

            previous += chunk
            let clean = chunk.toString() // removeUnicode(chunk.toString())
            let lines = clean.split(EOL).map((l: string) => chomp(l.trim()))

            while (lines.length > 0) {
                const line = lines.shift()
                if (line && line.length > 0) {
                    yield line
                }
            }
        }

    }

    private async processStdoutChunk(stdoutChunk: any) {

        // Pause the stream until analysis is done
        this.child_process.stdout.pause()
        // console.log(chalk.yellow('processStdoutChunk:', stdoutChunk.toString()))
        await this.processStdout(stdoutChunk)
        // Handle backpressure by waiting for both mutex to be released
        await this.mutex['stdout'].waitForUnlock()
        await this.mutex['traceWindow'].waitForUnlock()
        // Resume the stream
        this.child_process.stdout.resume()

    }

    private async processStdout(stdoutChunk: any) {

        const data = chomp(stdoutChunk.toString());
        const timestamp = Date.now();
        this.lastOutputAt = timestamp

        // Need a reliable way to detect if the chunk contains a prompt
        // console.log(chalk.gray(`\n checking for ${data} \n `))
        const { isPrompt, promptString, hasDefault, promptDefault } = this.isAPrompt(data)

        if (!isPrompt) {
            await this.disableQuestionTraceWindow()
            return
        }

        const promptKey = toCamelCase(promptString)
        this.lastPromptKey = promptKey
        const providedInput = this.input[promptKey]

        // record
        this.outputTimeline[timestamp] = data;

        // store prompt
        this.promptsTimeline[timestamp] = { data, promptString, hasDefault, promptDefault };

        // Begin the input checking process
        if (providedInput) {
            this.outputTimeline[timestamp] = promptKey;
            // console.log(chalk.gray(`Input for ${promptKey} =`, providedInput))
            // pass the output to the child process
            this.child_process.stdin.write(providedInput + '\n')
            this.processInputLine({
                key: promptKey,
                value: providedInput,
                default: false,
                timestamp
            } as ProvidedInput)
            return
        }

        // Use defaults if available 
        if (hasDefault) {
            this.outputTimeline[this.lastOutputAt] = promptKey;
            // @todo introduce setting to enable/disable default values
            this.child_process.stdin.write(`\n`)
            this.processInputLine({
                key: promptKey,
                value: '\n',
                default: true,
                timestamp
            } as ProvidedInput)
            return
        }

        // Begin the interactive process
        // @todo introduce setting to enable/disable the interactive process
        await this.disableQuestionTraceWindow()
        await this.enableQuestionTraceWindow()
        await this.enableQuestionTrace()
        // console.log(chalk.gray('<- Checking for input', promptKey))

        // Begin the AI process
        // @todo introduce setting to enable/disable the AI process
        if (this.aiEnabled) {
            // OpenAI API call
            const parsed = await this.gptChat.parseOutputWithNlp(data)

            // console.log(chalk.gray(`Parsed call`, JSON.stringify(parsed, null, 2)))

            // @todo handle parsed output and handle function calling
            if (parsed && isChatCompletionResponseMessage(parsed.message) && parsed.finish_reason === 'function_call') {

                const { message } = parsed

                const fn: ChatCompletionRequestMessageFunctionCall = message.function_call!

                let args = JSON.parse(fn.arguments ?? '{}')

                if (args.prompt && this.input[args.prompt]) {
                    // there is a defined input for this prompt
                    args.suggestion = this.input[args.prompt]
                }

                // acquire the mutex
                await this.lock('stdout')

                // invoke the most adecuated function according to openAI
                const stdout = await invokeFunction(this, fn?.name ?? '', args)

                if (stdout) {
                    // pass the output to the child process
                    this.child_process.stdin.write(stdout + '\r\n')
                    this.processInputLine(stdout)
                }

                // release the mutex
                await this.release('stdout')
            } else {
                console.log(parsed?.message?.content)
            }
        }


    }
    private isAPrompt(data: string) {
        let isPrompt = false
        let hasDefault = false
        let promptString = ''
        let promptDefault = ''
        for (const pp of promptTemplates) {
            const substr = getSubstringsByMask(pp, data);
            if (!substr || typeof substr === 'undefined') {
                continue;
            }
            const { prompt: promptValue, default: defaultValue } = substr;
            isPrompt = promptValue && promptValue.length > 0;
            if (isPrompt) {
                promptString = promptValue;
                hasDefault = defaultValue && defaultValue.length > 0;
                if (hasDefault) {
                    promptDefault = defaultValue;
                }
                break;
            }
        }
        return { isPrompt, hasDefault, promptString, promptDefault };
    }

    async enableQuestionTraceWindow() {
        if (this.mutex['traceWindow'].isLocked()) {
            throw new Error('Cannot enable question trace window, it is already enabled')
        }
        await this.mutex['traceWindow'].acquire()
    }
    disableQuestionTraceWindow() {
        return Promise.all([
            this.mutex['stdout'].release(),
            this.mutex['traceWindow'].release()
        ])
    }

    private async enableQuestionTrace() {
        this.questionTrace = true
        await this.lock('stdout')
    }
    private async disableQuestionTrace() {
        this.questionTrace = false
        await this.release('stdout')
    }

    private mergeHistory(): IoRecord[] {

        // get object keys
        const sortedInputKeys = Object.keys(this.inputTimeline).sort()
        const sortedOutputKeys = Object.keys(this.outputTimeline).sort()
        const mergedSortKeys = [...sortedInputKeys, ...sortedOutputKeys].sort()

        return mergedSortKeys.map((value, index: number) => {
            const accessKey = value as unknown as number
            let type: Io
            let timelineItem: string | number[] = this.inputTimeline[accessKey] ?? this.outputTimeline[accessKey]
            if (Array.isArray(timelineItem)) { //input keys
                type = 'input'
                timelineItem = timelineItem.map((c: number) => String.fromCharCode(c)).join('')
            } else { // output keys
                type = 'output'
                timelineItem = chomp(timelineItem) as string
            }
            const nearestBefore = index === 0 ? undefined : {
                index: index - 1,
                timestamp: mergedSortKeys[index - 1] as unknown as number
            }
            return new IoRecord({
                type,
                timestamp: accessKey,
                value: timelineItem,
                previousNeighbor: nearestBefore
            })
        })
    }

    /**
     * 
     */
    private async handleKeypress(str: any, key: { sequence: string, name: string, ctrl: boolean }) {
        if (this.isExitCombination(key)) {
            console.log('Bye')
            this.beforeExit()
            process.exit()
        }
        if (this.mutex['traceWindow'].isLocked() && this.isTrackingHint(key)) {
            console.log('tracking hint', this.lastPromptKey)
            // console.log('input buffer', this.getBufferInput())
            // we're done with the trace window
            await this.disableQuestionTraceWindow()
            return
        }

        if (key.ctrl && key.name === 'c') {
            this.dumpHistory()
            process.exit();
        } else if (key.name === 'backspace') {
            this.keybuffer.splice(- 1, 1)
            process.stdout.clearLine && process.stdout.clearLine(0)
            process.stdout.cursorTo && process.stdout.cursorTo(0)
            const input = chomp(this.keybuffer.join('')).replace(/\r*/, '')
            const stdout = this.outputTimeline[this.lastOutputAt]
            this.child_process.stdin.write(key.sequence)
            this.write(`${stdout}${input}`)
        } else if (key.name === 'return' || key.name === 'enter') {
            const input = this.getBufferInput()
            this.processInputLine(input)
            this.write(input + '\n')
            this.keybuffer = []
            // }
            //  else if (
            //     key.name === 'tab' || // tab key
            //     [38, 40, 37, 39].includes(key) || // cursor keys
            //     ['up', 'down', 'left', 'right'].includes(key.name) // cursor keys
            // ) {
            // @todo handle special keys such as cursor keys
            // this.keybuffer.push(str)
        } else {
            this.keybuffer.push(str)
            // @todo define a keymap for special keys
            // pass through
            this.write(key.sequence)
        }
    }
    private write(sequence: string) {
        // console.log(chalk.green(`>> (${sequence.length})`, sequence.toString()))
        process.stdout.write(sequence)
    }
    private getBufferInput() {
        return chomp(this.keybuffer.join('')).replace(/\r*/, '');
    }

    isExitCombination(key: { sequence: string; name: string; ctrl: boolean; }) {
        return (key.ctrl && key.name === 'c') || (key.ctrl && key.name === 'q')
    }

    isTrackingHint(key: { sequence: string; name: string; ctrl: boolean; }) {
        // check if the key is a hint
        return key.ctrl
    }

    private dumpHistory(): RecordHistory {
        process.stdout.clearLine && process.stdout.clearLine(0)
        process.stdout.cursorTo && process.stdout.cursorTo(0)
        const history = this.mergeHistory()

        const prompts = Object.keys(this.promptsTimeline).map((timestamp: string) => {
            const { data, promptString, hasDefault, promptDefault } = this.promptsTimeline[parseInt(timestamp)]
            return {
                name: hasDefault ? promptString : data,
                skip: hasDefault,
            } as PromptWithInfo
        })

        const job: Job = {
            id: 'axo',
            command: this.args[0],
            params: this.args.slice(1),
            settings: [
                {
                    name: 'exitOnMatch',
                    value: 'An error occurred'
                }
            ],
            // context: {
            //     name: 'My job',
            //     startedAt: this.connectedAt
            // },
            interaction: {
                prompts,
                attention: []
            }
        }
        return {
            history,
            job
        }
    }

    private recordLine({ line }: { line: string | ProvidedInput | SkippedInput; }) {
        const timestamp = Date.now()
        const isLineString = (line: any): line is string => typeof line === 'string'
        const isProvidedInput = (line: any): line is ProvidedInput => {
            return typeof line === 'object' && Object.keys(line).sort() === ['key', 'value', 'timestamp'].sort()
        }

        assert(!this.inputTimeline[timestamp], 'Timestamp already exists')

        if (isLineString(line)) {
            this.inputTimeline[timestamp] = line.split('').map((c: string) => c.charCodeAt(0))
        } else if (isProvidedInput(line)) {
            // in the case of a provided input
            // we should store that input along the key and the timestamp
            const { key, value, timestamp: when } = line
            this.inputTimeline[when] = value.split('').map((c: string) => c.charCodeAt(0))
        } else {
            // @todo handle skipped input
            console.log('Skipped input', line)
        }
    }

    private processInputLine(line: string | ProvidedInput | SkippedInput) {
        this.recordLine({ line })
    }
}

/**
 * 
 * @param params 
 */
export async function handler(params: { _: string[], input?: string[] }) {
    const cli_args = params._
    const observer = new CliLearnObserver(cli_args.slice(1), params.input)
    return await observer.observe()
}

export default handler