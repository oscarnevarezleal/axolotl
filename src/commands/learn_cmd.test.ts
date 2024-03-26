import { promptTemplates } from '../io/promptTemplates';
import { IoRecord } from '../types';
import { CliLearnObserver } from './learn_cmd';

describe('CliLearnObserver', () => {

    describe('when the command runs', () => {

        it('generates an expected learned output', async () => {
            const beforeExit = jest.fn();
            const command = 'node'
            const args = ['-r',
                '@swc-node/register',
                'src/utils/tests/backpressure.ts']

            // launch a child process that will write to stdout
            const learnHandler = new CliLearnObserver([
                'node',
                ...args
            ], [], { beforeExit });

            // let the handler observe it
            await learnHandler.observe()


            expect(beforeExit).toBeCalledWith({
                job: expect.objectContaining({
                    command,
                    id: 'axo',
                    params: args,
                    settings: [
                        {
                            name: 'exitOnMatch',
                            value: "An error occurred",
                        }
                    ]
                }),
                history: expect.anything(),
            }, expect.anything())

            const lastCall = beforeExit.mock.calls[0][0]

            // const expectedHistoryRecord: IoRecord[] = []
            // const expectedPrompts = promptTemplates.map((_prompt, i) => `prompt_${i}` )
            // expect(lastCall.history).toEqual([])
            // expect(lastCall.job.interaction.prompts).arrayContaining(expectedPrompts);


        }, 25000);

    })

})