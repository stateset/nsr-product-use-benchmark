import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOpenAIResponse, responseTools, runSession } from './openai-responses.mjs'

test('MCP tools map to non-strict Responses function tools', () => {
  assert.deepEqual(responseTools([{ name: 'nsr_decide', description: 'Decide', inputSchema: { type: 'object' } }]), [
    { type: 'function', name: 'nsr_decide', description: 'Decide', parameters: { type: 'object' }, strict: false },
  ])
})

test('adapter forwards a real function result using the response call ID', async () => {
  const requests = []
  const calls = []
  const responses = [
    { id: 'resp_1', status: 'completed', output: [{ type: 'function_call', call_id: 'call_1', name: 'nsr_refusal_gaps', arguments: '{"window_secs":604800}' }] },
    { id: 'resp_2', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"disposition":"report","predicate":"inspection_passed"}' }] }] },
  ]
  const final = await runSession(
    { type: 'start', prompt: 'Find gaps', instruction: 'Use NSR', tools: [{ name: 'nsr_refusal_gaps', description: 'Gaps', inputSchema: { type: 'object' } }] },
    async (name, args) => { calls.push({ name, args }); return { leading_predicate: 'inspection_passed' } },
    async (request) => { requests.push(request); return responses.shift() },
    'test-model',
  )
  assert.deepEqual(calls, [{ name: 'nsr_refusal_gaps', args: { window_secs: 604800 } }])
  assert.equal(requests[0].model, 'test-model')
  assert.equal(requests[0].store, true)
  assert.equal(requests[1].previous_response_id, 'resp_1')
  assert.deepEqual(requests[1].input, [{ type: 'function_call_output', call_id: 'call_1', output: '{"leading_predicate":"inspection_passed"}' }])
  assert.deepEqual(final, { disposition: 'report', predicate: 'inspection_passed' })
})

test('HTTP adapter sends authorized JSON without exposing API error details', async () => {
  let sent
  const result = await createOpenAIResponse({ model: 'test-model', input: 'hi' }, {
    apiKey: 'test-secret',
    fetchImpl: async (url, options) => {
      sent = { url, options }
      return { ok: true, json: async () => ({ id: 'resp_1' }) }
    },
  })
  assert.equal(sent.url, 'https://api.openai.com/v1/responses')
  assert.equal(sent.options.headers.Authorization, 'Bearer test-secret')
  assert.deepEqual(JSON.parse(sent.options.body), { model: 'test-model', input: 'hi' })
  assert.deepEqual(result, { id: 'resp_1' })
  await assert.rejects(createOpenAIResponse({}, { apiKey: 'test-secret', fetchImpl: async () => ({ ok: false, status: 401 }) }), /HTTP 401/)
})
