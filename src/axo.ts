#!/usr/bin/env node

import { handler as mainHandler } from './commands/run_cmd'
import { handler as learnCommand } from './commands/learn_cmd'

require('yargs')
  .scriptName('axo')
  .usage('$0 <cmd> [args]')
  .command('learn [command]',
    'learn about a command',
    (yargs: any) => {
      yargs.option('i', {
        alias: 'input',
        describe: 'Default inputs to use',
        type: 'array'
      });
      yargs.positional('command', {
        type: 'string',
        default: 'the_command_name',
        describe: 'the name of the command to learn about',
      })
    }, learnCommand)
  .command(
    'run [seed]',
    'ahoi!',
    (yargs: {
      option: any,
      alias: any,
      demandOption: any,
      positional: (
        arg0: string,
        arg1: { type: string; default: string; describe: string }
      ) => void
    }) => {
      yargs
        .positional('seed', {
          type: 'string',
          default: 'the_seeder_name',
          describe: 'the name of the seeder to run',
        })

      yargs.option('f', {
        alias: 'file',
        default: 'axo.yaml',
        describe: 'Config file to use',
        type: 'string'
      });
    },
    mainHandler
  )
  .count('verbose')
  .alias('v', 'verbose')
  .help().argv
