#!/usr/bin/env node
// Anthropic Messages API adapter for the benchmark's JSONL process protocol.
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const MAX_ROUNDS = 16

export function messageTools(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}

export async function runSession(start, callTool, createMessage, model) {
  if (start?.type !== 'start' || !Array.isArray(start.tools) || typeof start.prompt !== 'string') {
    throw new Error('invalid benchmark start message')
  }
  const messages = [{ role: 'user', content: start.prompt }]
  const system = `${start.instruction}\nReturn only a valid JSON object for the final answer, with no Markdown.`
  const tools = messageTools(start.tools)
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await createMessage({ model, max_tokens: 4096, system, tools, messages })
    if (response.stop_reason === 'end_turn') {
      const text = (response.content ?? []).filter((block) => block.type === 'text').map((block) => block.text).join('')
      const final = JSON.parse(text)
      if (!final || typeof final !== 'object' || Array.isArray(final)) {
        throw new Error('model final response must be a JSON object')
      }
      return final
    }
    if (response.stop_reason !== 'tool_use') {
      throw new Error(`model stopped with ${response.stop_reason ?? 'unknown reason'}`)
    }
    const calls = (response.content ?? []).filter((block) => block.type === 'tool_use')
    if (!calls.length) throw new Error('tool_use response omitted tool blocks')
    // Preserve all assistant blocks, including signed thinking blocks, unchanged.
    messages.push({ role: 'assistant', content: response.content })
    const results = []
    for (const call of calls) {
      if (!call.id || !call.name) throw new Error('model tool call omitted its ID or name')
      const result = await callTool(call.name, call.input)
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) })
    }
    messages.push({ role: 'user', content: results })
  }
  throw new Error('model exceeded message round limit')
}

export async function createAnthropicMessage(request, { apiKey = process.env.ANTHROPIC_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required')
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`Anthropic Messages API returned HTTP ${response.status}`)
  return response.json()
}

async function main() {
  const model = process.env.ANTHROPIC_MODEL
  if (!model) throw new Error('ANTHROPIC_MODEL is required')
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required')
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  let pendingResult
  let started = false
  for await (const line of lines) {
    const message = JSON.parse(line)
    if (message.type === 'result' && pendingResult) {
      pendingResult(message.result)
      pendingResult = null
      continue
    }
    if (message.type !== 'start' || started) throw new Error('unexpected benchmark protocol message')
    started = true
    const callTool = (tool, args) => new Promise((resolve) => {
      pendingResult = resolve
      process.stdout.write(`${JSON.stringify({ type: 'call', tool, arguments: args })}\n`)
    })
    runSession(message, callTool, createAnthropicMessage, model)
      .then((final) => process.stdout.write(`${JSON.stringify({ type: 'final', final })}\n`))
      .catch((error) => { console.error(error.message); process.exitCode = 1; lines.close() })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
