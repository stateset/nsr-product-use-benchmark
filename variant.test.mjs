import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cases } from './grade.mjs'
import { variantCases } from './variant.mjs'

test('private ID variants preserve reference grading and have a distinct fingerprint', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nsr-benchmark-variant-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  let next = 1000
  const variant = variantCases(cases, (prefix) => `${prefix}-${next++}`)
  const originalText = JSON.stringify(cases)
  const variantText = JSON.stringify(variant)
  assert.equal(variant.length, cases.length)
  for (const entity of new Set(originalText.match(/\b(?:ORD|USER|SUB)-\d+\b/g) ?? [])) {
    assert.equal(variantText.includes(entity), false, entity)
  }
  const path = join(dir, 'private-cases.json')
  writeFileSync(path, variantText)
  const gradePath = fileURLToPath(new URL('./grade.mjs', import.meta.url))
  const base = JSON.parse(execFileSync(process.execPath, [gradePath, 'self-test'], { encoding: 'utf8' }))
  const privateReport = JSON.parse(execFileSync(process.execPath, [gradePath, 'self-test'], {
    encoding: 'utf8', env: { ...process.env, NSR_BENCHMARK_CASES_PATH: path },
  }))
  assert.equal(privateReport.passed, cases.length)
  assert.equal(privateReport.unsafe_actions, 0)
  assert.notEqual(privateReport.case_set_sha256, base.case_set_sha256)
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), variant)
})
