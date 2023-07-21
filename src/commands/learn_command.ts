import { chomp } from '@rauschma/stringio';
import * as child_process from 'child_process';
import { emitKeypressEvents } from 'node:readline';
import { Job } from '../types';

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
    async observe() {

        // This needs to be moved to function and condition with a flag setting


        const isRawMode = true
        const command = this.args[0]
        console.log(command, this.args.slice(1))

        const child = child_process.spawn(command, this.args.slice(1))

        child.stdout.on('connection', () => {
            console.log('connection')
            process.stdout.clearLine(0)
            process.stdout.cursorTo(0)
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
            console.log('exit', this.inputTimeline)
            process.exit()
        })


        this.child_process = child
    }
    mergeHistory() {

        // get object keys
        const sortedInputKeys = Object.keys(this.inputTimeline).sort()
        const sortedOutputKeys = Object.keys(this.outputTimeline).sort()
        const mergedSortKeys = [...sortedInputKeys, ...sortedOutputKeys].sort()

        // @todo merge the input and output history
        const mapped = mergedSortKeys.map((value) => {
            const accessKey = value as unknown as number
            let timelineItem: string | number[] = this.inputTimeline[accessKey] ?? this.outputTimeline[accessKey]
            if (Array.isArray(timelineItem)) { //input keys
                timelineItem = timelineItem.map((c: number) => String.fromCharCode(c)).join('')
            } else {
                timelineItem = chomp(timelineItem) as string
            }
            return { [value]: timelineItem } as Record<number, string>
        })
        return mapped
    }
    dumpHistory() {
        process.stdout.clearLine(0)
        process.stdout.cursorTo(0)
        console.log(JSON.stringify(this.mergeHistory(), null, 2))
        const job: Job = {
            command: this.args[0],
            params: this.args.slice(1),
            context: 'This is a daemon job'
        }
        console.log(job)
        // @todo save to file or display the history as a reusable yaml
        // using this format: 
        // - name: "My job"
        //     id: x
        //     command: "node"
        //     params:
        //     - "-r"
        //     - "@swc-node/register"
        //     - "scripts/seed.ts"
        //     description: "My job description"
        //     context: |
        //     This is a daemon job
    }
    recordLine(line: any) {
        this.inputTimeline[Date.now()] = line.split('').map((c: string) => c.charCodeAt(0))
    }

    constructor(private args: string[]) {
    }
}

export default handler