import YAML from 'yaml';
import { readConfigFile } from './reader';
import { Job, JobItem } from '../types';

interface ReadResult {
    jobs: JobItem[]
}

export class YamlReader {

    public static readJobsFromFile(file: string): ReadResult {
        const config_file_content = readConfigFile(file);
        const { jobs } = YAML.parse(config_file_content)
        return {
            jobs: jobs.map((j: any) => new JobItem(j as Job))
        }
    }
}