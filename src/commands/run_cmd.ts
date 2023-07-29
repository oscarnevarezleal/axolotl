import YAML from 'yaml';
import { CliReader, readConfigFile } from '../io/reader';

/**
 * run handler
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

  const settings: Record<string, boolean> = job?.settings?.reduce((acc:any, s:any) => {
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
