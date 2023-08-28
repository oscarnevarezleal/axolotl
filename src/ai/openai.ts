import { ChatCompletionRequestMessage, ChatCompletionResponseMessage, Configuration, CreateChatCompletionRequest, CreateChatCompletionResponseChoicesInner, OpenAIApi } from 'openai'
import { ASSISTANT_CONTEXT, ASSISTANT_CONTEXT_CLI, OPENAI_MODEL } from '../config/constants'
import { FN_PARSE_PROMPT, FN_PARSE_PROMPT_AND_SUGGESTION, FN_PARSE_PROMPT_AND_SUGGESTION_ASSISTANT_CONTEXT } from './functions'
import chalk from 'chalk'
import { randomUUID } from 'node:crypto'

const defaultOpenAiConfiguration = new Configuration({
  apiKey:
    process.env.OPENAI_API_KEY ?? 'xyz',
})

const createChatCompletionRequestDefaults = {
  model: OPENAI_MODEL,
  temperature: 0.5,
  max_tokens: 256,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
}

export const openai = new OpenAIApi(defaultOpenAiConfiguration)

export async function getInputPrompt(prompt: string): Promise<string | ChatCompletionResponseMessage | undefined> {

  const openai = new OpenAIApi(defaultOpenAiConfiguration)

  const response = await openai.createChatCompletion({
    model: OPENAI_MODEL,
    messages: [
      {
        role: 'system',
        content: ASSISTANT_CONTEXT,
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0,
    max_tokens: 256,
    top_p: 0,
    frequency_penalty: 0,
    presence_penalty: 0,
  })

  return response.data.choices[0].message
}

export const isChatCompletionResponseMessage = (message: any): message is ChatCompletionResponseMessage => {
  return message?.role && 'content' in message
}

export async function parseOutputWithNlp({ openai: openAIInstance, prompt }: { openai: OpenAIApi; prompt: string }): Promise<CreateChatCompletionResponseChoicesInner | undefined> {

  const openai = openAIInstance ?? new OpenAIApi(defaultOpenAiConfiguration)

  const response = await openai.createChatCompletion({
    ...createChatCompletionRequestDefaults,
    messages: [
      {
        role: 'system',
        content: FN_PARSE_PROMPT_AND_SUGGESTION_ASSISTANT_CONTEXT,
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    functions: [FN_PARSE_PROMPT_AND_SUGGESTION, FN_PARSE_PROMPT],
    function_call: 'auto'
  })

  return response.data.choices[0]
}

export interface AwareChatProps {
  openAi?: OpenAIApi
  openAiSettings?: Partial<CreateChatCompletionRequest>
  systemContext: string;
  context?: string
  messages?: ChatCompletionRequestMessage[] | ChatCompletionResponseMessage[]
}

export class AwareChat {
  openai: any
  messages: ChatCompletionRequestMessage[] | ChatCompletionResponseMessage[] = []

  /**
   * 
   * @param systemContext 
   * @param context 
   */
  // 
  constructor(protected props: AwareChatProps) {

    const { systemContext, context, openAi, messages } = props

    this.openai = openAi ?? new OpenAIApi(new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    }))

    this.messages = [
      {
        role: 'system',
        content: systemContext || ASSISTANT_CONTEXT_CLI,
      },
      ...(messages ?? [])
    ]

    if (context) {
      this.setContext(context)
    }
  }

  setContext(context: string) {
    this.messages.push({
      role: 'user',
      content: context,
    })
  }

  async chat(prompt: string): Promise<CreateChatCompletionResponseChoicesInner | null> {
    // console.log('chat', prompt)
    const sid = randomUUID()

    const { openAiSettings } = this.props

    const message: ChatCompletionRequestMessage = {
      role: 'user',
      content: prompt,
    }
    try {
      const messages = this.messages.concat(message)

      console.log(chalk.yellow(`[AI input] ${sid} 🤖 `, prompt))

      const response = await openai.createChatCompletion({
        messages,
        ...createChatCompletionRequestDefaults,
        ...openAiSettings
      })

      console.log(chalk.green(`[AI output] ${sid} 🤖 `, JSON.stringify(response.data, null, 3)))

      const textResponse: CreateChatCompletionResponseChoicesInner | undefined = response.data.choices[0]

      this.messages = messages.concat(
        { role: 'user', content: prompt },
        { role: 'assistant', content: textResponse?.message?.content ?? '' },
      )

      return textResponse

    } catch (error: any) {
      if (error?.response) {
        console.log(error?.response?.status)
        console.log(error?.response?.data)
      } else {
        console.log(error?.message)
      }
      return null
    }
  }

  async parseOutputWithNlp(prompt: string) {
    return parseOutputWithNlp({ openai: this.openai, prompt })
  }
}

export interface IOpenAiChannel {
  observe(): void
  lock(key:string): void
  release(key:string): void
}