import YAML from 'yaml';
import { CliReader, readConfigFile } from '../io/reader';
import { YamlReader } from '../io/yamlReader';
import { JobItem } from '../types';

/**
 * run handler
 * @param seed
 */
export async function handler({
  file,
  seed,
  verbose,
}: {
  file: string
  seed: string
  verbose?: number
}): Promise<any> {
  const VERBOSE_LEVEL = verbose || 0

  const { jobs } = YamlReader.readJobsFromFile(file)
  const jobItem = jobs.find((j: JobItem) => j.job.id === seed)

  if (!jobItem) {
    console.log(`No job found for ${seed}`)
    process.exit(1)
  }

  const cli = new CliReader({
    job: jobItem,
    verbose: VERBOSE_LEVEL,
  })

  return cli.processCommand()
}
