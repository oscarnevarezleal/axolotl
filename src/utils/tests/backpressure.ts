import { Readable, Writable } from 'stream';
import { faker } from '@faker-js/faker';

import {promptTemplates} from '../../io/promptTemplates'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function* asyncGenerator() {
    let i = 0;
    while (i < promptTemplates.length) {
        const prompt = promptTemplates[i]
            .replace('{prompt}', `prompt_${i}`)
            .replace('{default}', Date.now().toString())
        yield { data: prompt };
        i++
    }
}

class PromptProducer extends Readable {
    public delay: number;
    private _tag = '[Readable]';
    private _generator = asyncGenerator();

    constructor(delay: number) {
        super({
            objectMode: true,
            highWaterMark: 2,
        });

        this.delay = delay;
    }

    async _read(size: number) {
        while (true) {
            await sleep(this.delay);
            const { value, done } = await this._generator.next();
            const bufferFull = this.push(value);
            // console.log(this._tag, `Pushed ${JSON.stringify(value)}`, this.readableLength);

            if (done) {
                this.push(null);
                break;
            }

            if (bufferFull) {
                break;
            }
        }
    }
}

class TestWritable extends Writable {
    public delay: number;
    private _tag = '[Writable]';

    constructor(delay: number) {
        super({
            objectMode: true,
            highWaterMark: 2,
        });

        this.delay = delay;
    }

    async _write(chunk: any, encoding: BufferEncoding, callback: (error?: (Error | null)) => void) {
        await sleep(this.delay);
        // console.log(this._tag, `Received ${JSON.stringify(chunk)}`);
        console.log(chunk?.data ?? '')
        callback();
    }
}

(async() => {
    console.log('start')
    const readable = new PromptProducer(100);
    const writable = new TestWritable(0);
    readable
        .pipe(writable)
        .on('finish', () => console.log('finished'))
})();