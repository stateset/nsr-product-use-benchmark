#!/usr/bin/env node
// OpenAI Responses API adapter for the benchmark's JSONL process protocol.
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const ENDPOINT = 'https://api.openai.com/v1/responses'
const MAX_ROUNDS = 16

export function responseTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false, // The portable MCP schemas intentionally have optional fields.
  }))
}

function outputText(response) {
  return (response.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('')
}

export async function runSession(start, callTool, createResponse, model) {
  if (start?.type !== 'start' || !Array.isArray(start.tools) || typeof start.prompt !== 'string') {
    throw new Error('invalid benchmark start message')
  }
  const tools = responseTools(start.tools)
  const instructions = `${start.instruction}\nReturn only a valid JSON object for the final answer, with no Markdown.`
  let input = start.prompt
  let previousResponseId
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const request = { model, instructions, input, tools, store: true }
    if (previousResponseId) request.previous_response_id = previousResponseId
    const response = await createResponse(request)
    if (response.status && response.status !== 'completed') {
      throw new Error(`model response ${response.status}`)
    }
    const calls = (response.output ?? []).filter((item) => item.type === 'function_call')
    if (!calls.length) {
      const final = JSON.parse(outputText(response))
      if (!final || typeof final !== 'object' || Array.isArray(final)) {
        throw new Error('model final response must be a JSON object')
      }
      return final
    }
    if (!response.id) throw new Error('model response omitted its ID')
    input = []
    for (const call of calls) {
      if (!call.call_id || !call.name) throw new Error('model function call omitted its ID or name')
      const args = JSON.parse(call.arguments)
      const result = await callTool(call.name, args)
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) })
    }
    previousResponseId = response.id
  }
  throw new Error('model exceeded response round limit')
}

export async function createOpenAIResponse(request, { apiKey = process.env.OPENAI_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required')
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`OpenAI Responses API returned HTTP ${response.status}`)
  return response.json()
}

async function main() {
  const model = process.env.OPENAI_MODEL
  if (!model) throw new Error('OPENAI_MODEL is required')
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required')
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
    runSession(message, callTool, createOpenAIResponse, model)
      .then((final) => process.stdout.write(`${JSON.stringify({ type: 'final', final })}\n`))
      .catch((error) => { console.error(error.message); process.exitCode = 1; lines.close() })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
