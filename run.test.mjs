import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAll, runCase } from './run.mjs'

const adapter = String.raw`
const readline = require('node:readline')
const lines = readline.createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.type === 'start') {
    if (!message.prompt || !message.tools.some((tool) => tool.name === 'nsr_refusal_gaps')) process.exit(2)
    process.stdout.write(JSON.stringify({ type: 'call', tool: 'nsr_refusal_gaps', arguments: { window_secs: 604800 } }) + '\n')
  } else if (message.type === 'result') {
    process.stdout.write(JSON.stringify({ type: 'final', final: { disposition: 'report' } }) + '\n')
  }
})
`

test('runner passes public task data and earned tool results through the adapter protocol', async () => {
  const attempt = await runCase('weekly_refusal_gaps', [process.execPath, '-e', adapter], 5000)
  assert.equal(attempt.runner_error, undefined)
  assert.deepEqual(attempt.calls, [{ tool: 'nsr_refusal_gaps', arguments: { window_secs: 604800 } }])
  assert.deepEqual(attempt.final, { disposition: 'report' })
})

test('runner records an adapter that exits without a final response', async () => {
  const attempt = await runCase('weekly_refusal_gaps', [process.execPath, '-e', 'process.exit(0)'], 5000)
  assert.match(attempt.runner_error, /before final response/)
})

test('runner writes one independently graded attempt per case', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nsr-benchmark-run-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const output = join(dir, 'attempts.jsonl')
  const report = await runAll([process.execPath, '-e', adapter], output, 5000)
  const attempts = readFileSync(output, 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(attempts.length, report.cases)
  assert.equal(report.results.length, report.cases)
  assert.ok(report.passed < report.cases) // the fixture adapter is deliberately incomplete
})
