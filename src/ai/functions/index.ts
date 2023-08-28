import { IOpenAiChannel } from "../openai"

export const FN_PARSE_PROMPT_AND_SUGGESTION_ASSISTANT_CONTEXT =
    'You are a command line application observer. Your job is to watch stdin and stdout and analize what data was exchanged between the user and the application.'

export const FN_PARSE_PROMPT_AND_SUGGESTION = {
    'name': 'parse_stdout_and_get_prompt_and_suggested_value',
    'description': 'Parse the string and and extract the prompt question and suggested default value',
    'parameters': {
        'type': 'object',
        'properties': {
            'prompt': {
                'type': 'string',
                'description': 'Parsed output prompt question (alphanumeric, pascal case notation)'
            },
            'suggestion': {
                'type': 'string',
                'description': 'Suggested default value'
            }
        }
    }
}

export const FN_PARSE_PROMPT = {
    'name': 'parse_stdout_prompt_question',
    'description': 'Parse the string and and extract the prompt question',
    'parameters': {
        'type': 'object',
        'properties': {
            'prompt': {
                'type': 'string',
                'description': 'Parsed output prompt question (alphanumeric, pascal case notation)'
            }
        }
    }
}

function parse_stdout_prompt_question(prompt: string) {
    // console.log('>', { prompt })
    return '\n'
}

function parse_stdout_and_get_prompt_and_suggested_value(prompt: string, suggestion: string) {
    // console.log('>', { prompt, suggestion })
    return suggestion
}

export async function invokeFunction(impl: IOpenAiChannel, fn: string, args: any): Promise<string | undefined> {
    switch (fn) {
        case 'parse_stdout_prompt_question':
            return parse_stdout_prompt_question(args.prompt)
        case 'parse_stdout_and_get_prompt_and_suggested_value':
            return parse_stdout_and_get_prompt_and_suggested_value(args.prompt, args.suggestion)
    }
    return ''
}