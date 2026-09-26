import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAnthropicMessage, messageTools, runSession } from './anthropic-messages.mjs'

test('MCP tools map to Messages client tools', () => {
  assert.deepEqual(messageTools([{ name: 'nsr_decide', description: 'Decide', inputSchema: { type: 'object' } }]), [
    { name: 'nsr_decide', description: 'Decide', input_schema: { type: 'object' } },
  ])
})

test('adapter preserves assistant blocks and returns tool results by tool use ID', async () => {
  const requests = []
  const calls = []
  const responseContent = [
    { type: 'text', text: 'Checking NSR.' },
    { type: 'tool_use', id: 'toolu_1', name: 'nsr_refusal_gaps', input: { window_secs: 604800 } },
  ]
  const responses = [
    { stop_reason: 'tool_use', content: responseContent },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"disposition":"report","predicate":"inspection_passed"}' }] },
  ]
  const final = await runSession(
    { type: 'start', prompt: 'Find gaps', instruction: 'Use NSR', tools: [{ name: 'nsr_refusal_gaps', description: 'Gaps', inputSchema: { type: 'object' } }] },
    async (name, args) => { calls.push({ name, args }); return { leading_predicate: 'inspection_passed' } },
    async (request) => { requests.push(structuredClone(request)); return responses.shift() },
    'test-model',
  )
  assert.deepEqual(calls, [{ name: 'nsr_refusal_gaps', args: { window_secs: 604800 } }])
  assert.equal(requests[0].model, 'test-model')
  assert.equal(requests[0].max_tokens, 4096)
  assert.deepEqual(requests[1].messages, [
    { role: 'user', content: 'Find gaps' },
    { role: 'assistant', content: responseContent },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"leading_predicate":"inspection_passed"}' }] },
  ])
  assert.deepEqual(final, { disposition: 'report', predicate: 'inspection_passed' })
})

test('adapter rejects truncated responses', async () => {
  await assert.rejects(runSession(
    { type: 'start', prompt: 'Find gaps', instruction: 'Use NSR', tools: [] },
    async () => ({}), async () => ({ stop_reason: 'max_tokens', content: [] }), 'test-model',
  ), /max_tokens/)
})

test('HTTP adapter sends required API headers without exposing error details', async () => {
  let sent
  const result = await createAnthropicMessage({ model: 'test-model', messages: [] }, {
    apiKey: 'test-secret',
    fetchImpl: async (url, options) => {
      sent = { url, options }
      return { ok: true, json: async () => ({ id: 'msg_1' }) }
    },
  })
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(sent.options.headers['x-api-key'], 'test-secret')
  assert.equal(sent.options.headers['anthropic-version'], '2023-06-01')
  assert.deepEqual(result, { id: 'msg_1' })
  await assert.rejects(createAnthropicMessage({}, { apiKey: 'test-secret', fetchImpl: async () => ({ ok: false, status: 401 }) }), /HTTP 401/)
})
