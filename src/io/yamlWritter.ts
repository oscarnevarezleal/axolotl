import * as fs from 'fs';
import * as yaml from 'js-yaml';

/**
 * Write yaml file
 * @param data 
 * @param file 
 */
export function writeYaml(file: string, data: any){
    let yamlStr = yaml.dump(data);
    fs.writeFileSync(file, yamlStr, 'utf8')
}