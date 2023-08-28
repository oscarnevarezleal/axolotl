export interface PromptWithInfo {
    name: string;
    value: string;
    skip?: boolean;
    hidden?: boolean;
}

export interface PromptWithInfoAndDate extends PromptWithInfo {
    timestamp: number;
}

export type Prompt = string | PromptWithInfo | PromptWithInfoAndDate

export interface IoRecordNearestHint {
    index: number
    timestamp: number
}
export type JobContextWithInfo = {
    name: string
    startedAt?: number
}

export type JobContext = string | JobContextWithInfo

export interface Job {
    id: string
    command: string
    params: string[]
    settings: any[]
    context?: JobContext
    conclusion?: string
    output_instructions?: string
    interaction?: {
        prompts: Prompt[]
        attention: string[]
    }
}

export class JobItem {
    readonly settings: Record<string, boolean | string>;
    constructor(public readonly job: Job) {
        this.settings = this.parseSettings()
    }
    private parseSettings() {
        const settings: Record<string, boolean> = this.job?.settings?.reduce((acc: any, s: any) => {
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
        return settings
    }
}

export interface IoRecordProps {
    type: 'input' | 'output'
    timestamp: number
    value: string
    previousNeighbor?: IoRecordNearestHint
    nearestAfter?: IoRecordNearestHint
}
export class IoRecord {
    constructor(public readonly props: IoRecordProps) { }
    toString() {
        return `[${this.props.timestamp}][${this.props.type.substring(0, 3)}]   ${this.props.value}`
    }
}

export type ProvidedInput = {
    key: string
    value: string
}
export type SkippedInput = {
    key: string
}