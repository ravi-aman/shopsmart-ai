import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, type LanguageModel, Output, stepCountIs, type ToolSet } from 'ai'
import type { z } from 'zod'
import { config } from '../config.js'

/**
 * NVIDIA API (build.nvidia.com) through the AI SDK's OpenAI-compatible provider. NVIDIA rejects
 * chat requests without an explicit max token count, so every call sets maxOutputTokens.
 */
const nvidia = createOpenAICompatible({
  name: 'nvidia',
  baseURL: `${config.NVIDIA_BASE_URL.replace(/\/$/, '')}/v1`,
  apiKey: config.NVIDIA_API_KEY,
  // sends the zod schema as response_format json_schema; without it the model invents its own fields
  supportsStructuredOutputs: true,
})

export const models = {
  agent: (): LanguageModel => nvidia(config.NVIDIA_AGENT_MODEL),
  fast: (): LanguageModel => nvidia(config.NVIDIA_FAST_MODEL),
}

const common = () => ({
  maxOutputTokens: config.NVIDIA_MAX_TOKENS,
  maxRetries: 1,
  abortSignal: AbortSignal.timeout(config.AI_TIMEOUT_MS),
})

export interface Usage {
  promptTokens: number | null
  completionTokens: number | null
}

const usageOf = (u: { inputTokens?: number; outputTokens?: number } | undefined): Usage => ({
  promptTokens: u?.inputTokens ?? null,
  completionTokens: u?.outputTokens ?? null,
})

export async function chatText(model: LanguageModel, prompt: string, system?: string) {
  const r = await generateText({ model, system, prompt, temperature: 0, ...common() })
  return r.text
}

/** Structured output validated against a zod schema. */
export async function chatObject<S extends z.ZodType>(model: LanguageModel, schema: S, prompt: string, system: string) {
  const r = await generateText({ model, system, prompt, temperature: 0.2, output: Output.object({ schema }), ...common() })
  return { object: r.output as z.infer<S>, usage: usageOf(r.totalUsage ?? r.usage) }
}

/** Lets the model call tools (bounded loop) and returns its final text. */
export async function chatWithTools(model: LanguageModel, tools: ToolSet, prompt: string, system: string, maxSteps = 6) {
  const r = await generateText({ model, system, prompt, tools, stopWhen: stepCountIs(maxSteps), temperature: 0.2, ...common() })
  return { text: r.text, usage: usageOf(r.totalUsage ?? r.usage) }
}

// ------------------------------------------------------------------ embeddings

/**
 * NVIDIA retrieval embedders are asymmetric and need `input_type` (query vs passage), which the
 * generic OpenAI embedding client doesn't send — so embeddings call the REST API directly.
 */
export async function embedMany(texts: string[], inputType: 'query' | 'passage'): Promise<number[][]> {
  const out: number[][] = []
  const batch = 50
  for (let i = 0; i < texts.length; i += batch) {
    const body: Record<string, unknown> = {
      model: config.NVIDIA_EMBEDDING_MODEL,
      input: texts.slice(i, i + batch),
      input_type: inputType,
      encoding_format: 'float',
      truncate: 'END',
    }
    if (config.EMBEDDING_SEND_DIMENSIONS) body.dimensions = config.EMBEDDING_DIMENSIONS
    const res = await fetch(`${config.NVIDIA_BASE_URL.replace(/\/$/, '')}/v1/embeddings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.AI_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`NVIDIA embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const json = (await res.json()) as { data: { index: number; embedding: number[] }[] }
    for (const item of [...json.data].sort((a, b) => a.index - b.index)) {
      if (item.embedding.length !== config.EMBEDDING_DIMENSIONS) {
        throw new Error(`Embedding model ${config.NVIDIA_EMBEDDING_MODEL} returned ${item.embedding.length} dimensions but EMBEDDING_DIMENSIONS is ${config.EMBEDDING_DIMENSIONS}`)
      }
      out.push(item.embedding)
    }
  }
  return out
}

export async function embed(text: string, inputType: 'query' | 'passage') {
  return (await embedMany([text], inputType))[0]
}

export const toVectorLiteral = (v: number[]) => `[${v.join(',')}]`
