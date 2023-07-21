export interface Job{
    command: string
    params: string[]
    context: string
    conclusion?: string
    output_instructions?: string
    robot?: {
      prompts: string[]
      attention: string[]
    }
  }