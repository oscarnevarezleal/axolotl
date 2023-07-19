import { Configuration, OpenAIApi } from 'openai'

const configuration = new Configuration({
  apiKey:
    process.env.OPENAI_API_KEY ?? 'xyz',
})
export const openai = new OpenAIApi(configuration)

const ASSISTANT_CONTEXT =
  'You are a command line application that produces only valid JSON syntax it does not conversate just generates JSON output. ' +
  'The property keys of the JSON response are in camel case syntax and their values should be randomized.'

const ASSISTANT_CONTEXT_CLI =
  'You are a command line application that accepts JSON input. ' +
  'You produce only text plain short responses without a conversation or explanation. ' +
  'You are fed with an initial JSON object. ' +
  'When you are asked to set a property you should answer with the value of that property taken from the original JSON object'

export async function getInputPrompt(prompt: string): Promise<string> {
  const openai = new OpenAIApi(configuration)

  const response = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
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

export class AwareChat {
  openai: any
  messages: { role: string; content: string }[] = []

  constructor(context: string) {
    const { Configuration, OpenAIApi } = require('openai')

    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    })
    this.openai = new OpenAIApi(configuration)
    this.messages = [
      {
        role: 'system',
        content: ASSISTANT_CONTEXT_CLI,
      },
    ]
    if (context) {
      this.messages.push({
        role: 'user',
        content: context,
      })
    }
  }

  async chat(prompt: string): Promise<string | null> {
    try {
      const messages = [
        ...this.messages,
        {
          role: 'user',
          content: prompt,
        },
      ]

      // console.log(chalk.gray('[AI] 🤖 ', prompt))

      const response = await openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages,
        temperature: 0.5,
        max_tokens: 256,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      })

      const textResponse = response.data.choices[0].message

      // console.log('textResponse', textResponse)

      this.messages = [
        ...this.messages,
        { role: 'user', content: prompt },
        textResponse,
      ]

      return textResponse?.content
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
}
