import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cases, createSession } from './grade.mjs'
import { teachingExample } from './teach.mjs'

test('every teaching trajectory replays through the public simulator and passes its rubric', () => {
  for (const testCase of cases) {
    const example = teachingExample(testCase)
    const session = createSession(testCase.id)
    assert.equal(example.source, 'synthetic_reference')
    assert.equal(example.turns[0].content, session.prompt)
    assert.deepEqual(example.tools, session.tools)
    assert.equal(example.turns.length, 2 * testCase.steps.length + 2)
    for (let index = 0; index < testCase.steps.length; index++) {
      const call = example.turns[index * 2 + 1].tool_call
      const result = session.call(call.name, call.arguments)
      assert.deepEqual(result, example.turns[index * 2 + 2].content, testCase.id)
    }
    assert.equal(session.finish(example.turns.at(-1).content).passed, true, testCase.id)
  }
})
