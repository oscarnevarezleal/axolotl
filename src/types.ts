export interface PromptWithInfo {
    name: string;
    value: string;
}

export interface PromptWithInfoAndDate extends PromptWithInfo {
    timestamp: number;
}

export type Prompt = string | PromptWithInfo | PromptWithInfoAndDate

export interface IoRecordNearestHint{
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

export interface IoRecordProps {
    type: 'input' | 'output'
    timestamp: number
    value: string
    nearestBefore?: IoRecordNearestHint
    nearestAfter?: IoRecordNearestHint
}
export class IoRecord{
    constructor(public readonly props: IoRecordProps) {}
    toString() {
        return `[${this.props.timestamp}][${this.props.type.substring(0, 3)}]   ${this.props.value}`
    }
}