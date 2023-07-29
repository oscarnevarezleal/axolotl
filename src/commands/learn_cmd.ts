import { chomp } from '@rauschma/stringio';
import * as child_process from 'child_process';
import { emitKeypressEvents } from 'node:readline';
import { removeUnicode } from '../io/utils';
import { IoRecord, Job, Prompt } from '../types';
import { writeYaml } from '../io/yamlWritter';

/**
 * 
 * @param params 
 */
export async function handler(params: { _: string[] }) {
    const cli_args = params._
    const observer = new CliLearnObserver(cli_args.slice(1))
    await observer.observe()
}

/**
 * This class reads stdin and stdout of a command and records the input and output
 */
export class CliLearnObserver {
    keybuffer: string[] = []
    inputTimeline: Record<number, number[]> = {}
    outputTimeline: Record<number, string> = {}
    child_process: any
    connectedAt: number | undefined;
    async observe() {

        const isRawMode = true
        const command = this.args[0]

        if (!command) {
            console.error('No command given')
            process.exit(1)
        }

        const child = child_process.spawn(command, this.args.slice(1))

        child.stdout.on('connection', () => {
            // This needs to be moved to function and condition with a flag setting
            process.stdout.clearLine(0)
            process.stdout.cursorTo(0)
            this.connectedAt = Date.now()
        })

        child.stdout.on('data', (chunk: any) => {
            const data = chomp(chunk.toString())
            this.outputTimeline[Date.now()] = data
        })

        child.stdout.pipe(process.stdout);
        child.stderr.pipe(process.stderr);
        emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(isRawMode);
        process.stdin.on('keypress', async (str, key) => {

            this.keybuffer.push(str)

            if (key.ctrl && key.name === 'c') {
                this.dumpHistory()
                process.exit();
            } else if (key.name === 'backspace') {
                this.keybuffer.pop()
            } else if (key.name === 'return' || key.name === 'enter') {
                const input = chomp(this.keybuffer.join('')).replace(/\r*/, '')
                this.recordLine(input)
                this.keybuffer = []
                // @todo this is a hack to clear the line and might not fit all terminals
                process.stdout.write('\u001B[2J\u001B[0;0f')
                process.stdout.clearLine(0)
                this.child_process.stdin.write('\n')
            } else if (
                key.name === 'tab' || // tab key
                [38, 40, 37, 39].includes(key) || // cursor keys
                ['up', 'down', 'left', 'right'].includes(key.name) // cursor keys
            ) {
                // @todo handle special keys such as cursor keys
            } else {
                // @todo define a keymap for special keys
            }
        })

        process.stdin.pipe(child.stdin);

        child.on('exit', () => {
            this.dumpHistory()
            process.exit()
        })


        this.child_process = child
    }
    mergeHistory(): IoRecord[] {

        // get object keys
        const sortedInputKeys = Object.keys(this.inputTimeline).sort()
        const sortedOutputKeys = Object.keys(this.outputTimeline).sort()
        const mergedSortKeys = [...sortedInputKeys, ...sortedOutputKeys].sort()

        return mergedSortKeys.map((value, index: number) => {
            const accessKey = value as unknown as number
            let type: 'input' | 'output' = 'input'
            let timelineItem: string | number[] = this.inputTimeline[accessKey] ?? this.outputTimeline[accessKey]
            if (Array.isArray(timelineItem)) { //input keys
                type = 'input'
                timelineItem = timelineItem.map((c: number) => String.fromCharCode(c)).join('')
            } else { // output keys
                type = 'output'
                timelineItem = chomp(timelineItem) as string
            }
            return new IoRecord({
                type,
                timestamp: accessKey,
                value: timelineItem,
                nearestBefore: index === 0 ? undefined : {
                    index: index - 1,
                    timestamp: mergedSortKeys[index - 1] as unknown as number
                }
            })
        })
    }
    dumpHistory() {
        process.stdout.clearLine(0)
        process.stdout.cursorTo(0)
        const history = this.mergeHistory()
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
                prompts: history
                    .filter((record) => record.props.type === 'input')
                    .map((record) => {
                        const nearest = record.props.nearestBefore
                        const { timestamp } = record.props
                        let value: string | undefined = record.props.value
                        let skip = false
                        let name = 'prompt'
                        if (nearest) {
                            name = removeUnicode(history[nearest.index].props.value)
                        }
                        if (value === '\t\r' || value === '\n') {
                            value = undefined
                            skip = true
                        }
                        return {
                            name,
                            skip,
                            value,
                            timestamp
                        } as Prompt
                    }),
                attention: []
            }
        }
        const file = `${process.cwd()}/axo.yaml`
        writeYaml(file, { jobs: [job] })
        console.log('Wrote job to', file)
    }
    recordLine(line: any) {
        this.inputTimeline[Date.now()] = line.split('').map((c: string) => c.charCodeAt(0))
    }

    constructor(private args: string[]) {
    }
}

export default handler