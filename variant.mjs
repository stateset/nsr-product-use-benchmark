#!/usr/bin/env node
// Make a private entity-ID variant of the public synthetic cases.
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE_CASES_URL = new URL('./cases.json', import.meta.url)
const ENTITY_PATTERN = /\b(?:ORD|USER|SUB)-\d+\b/g

export function variantCases(baseCases, makeId = (prefix) => `${prefix}-${randomBytes(8).toString('hex').toUpperCase()}`) {
  let serialized = JSON.stringify(baseCases)
  const entities = [...new Set(serialized.match(ENTITY_PATTERN) ?? [])]
  const replacements = new Map()
  const used = new Set(entities)
  for (const entity of entities) {
    const prefix = entity.split('-')[0]
    let replacement
    for (let attempt = 0; attempt < 100; attempt++) {
      replacement = makeId(prefix, entity)
      if (!used.has(replacement)) break
    }
    if (used.has(replacement)) throw new Error(`could not generate a unique replacement for ${entity}`)
    if (!replacement.startsWith(`${prefix}-`)) throw new Error(`replacement for ${entity} changed its entity type`)
    used.add(replacement)
    replacements.set(entity, replacement)
  }
  serialized = serialized.replace(ENTITY_PATTERN, (entity) => replacements.get(entity))
  return JSON.parse(serialized)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--output') {
    console.error('Usage: node variant.mjs --output private-cases.json')
    process.exitCode = 2
  } else {
    const baseCases = JSON.parse(readFileSync(BASE_CASES_URL, 'utf8'))
    const variant = variantCases(baseCases)
    writeFileSync(args[1], `${JSON.stringify(variant, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    console.log(`Wrote ${variant.length} private synthetic cases to ${args[1]}`)
  }
}
