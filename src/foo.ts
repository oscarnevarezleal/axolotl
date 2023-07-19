// #!/usr/bin/env node
// import { Prompt } from '@poppinss/prompts'

// require('yargs')
//   .scriptName('pirate-parser')
//   .usage('$0 <cmd> [args]')
//   .command(
//     'hello [name]',
//     'welcome ter yargs!',
//     (yargs) => {
//       yargs.positional('name', {
//         type: 'string',
//         default: 'Cambi',
//         describe: 'the name to say hello to',
//       })
//     },
//     async function (argv) {
//       console.log('hello', argv.name, 'welcome to yargs!')
//       const prompt = new Prompt()
//       const username = await prompt.ask('What is your username?')
//       console.log(username)
//       const money = await promptRequiredMoney(
//         'Set total business credit limit',
//         '100'
//       )
//       console.log('welcome back', username)
//       console.log('glad you have ' + money + ' on you')
//     }
//   )
//   .help().argv

// export const promptRequiredMoney = async (
//   question: string,
//   defaultValue?: string
// ) => {
//   let prompt = new Prompt()
//   return prompt
//     .ask(question, {
//       default: defaultValue,
//       format(answer) {
//         return `$${answer}`
//       },
//       validate(answer) {
//         if (!answer) {
//           return 'Value is required'
//         }
//         if (isNaN(parseFloat(answer.replace(',', '')))) {
//           return `Value must be a valid number not "${answer}"`
//         }
//         return true
//       },
//       result(value) {
//         return value
//       },
//     })
//     .catch((err) => process.exit(0))
// }
