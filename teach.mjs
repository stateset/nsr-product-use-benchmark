#!/usr/bin/env node
// Export complete synthetic demonstrations for training and documentation.
import { fileURLToPath } from 'node:url'
import { cases, referenceAttempt, toolCatalog } from './grade.mjs'
import { INSTRUCTION } from './run.mjs'

export function teachingExample(testCase) {
  const reference = referenceAttempt(testCase)
  const turns = [{ role: 'user', content: testCase.prompt }]
  for (const [index, call] of reference.calls.entries()) {
    turns.push({ role: 'assistant', tool_call: { name: call.tool, arguments: call.arguments } })
    turns.push({ role: 'tool', name: call.tool, content: structuredClone(testCase.steps[index].response) })
  }
  turns.push({ role: 'assistant', content: structuredClone(reference.final) })
  return {
    format: 'nsr-teaching-trajectory-v1',
    source: 'synthetic_reference',
    id: testCase.id,
    skill: testCase.skill,
    instruction: INSTRUCTION,
    tools: structuredClone(toolCatalog),
    turns,
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const testCase of cases) console.log(JSON.stringify(teachingExample(testCase)))
}
