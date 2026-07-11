import { test } from 'node:test'
import * as assert from 'node:assert'
import { readFileSync } from 'node:fs'

const dataset = JSON.parse(readFileSync(new URL('../eval/dataset.json', import.meta.url)))
const VALID_TIERS = new Set(['Trivial', 'Routine', 'Hard'])

test('dataset is a non-empty array of labeled tasks', () => {
  assert.ok(Array.isArray(dataset))
  assert.ok(dataset.length >= 30, `need a meaningful sample, got ${dataset.length}`)
})

test('every item has a task string and a valid expectedTier', () => {
  for (const item of dataset) {
    assert.ok(typeof item.task === 'string' && item.task.length > 0, `bad task: ${JSON.stringify(item)}`)
    assert.ok(VALID_TIERS.has(item.expectedTier), `bad tier: ${item.expectedTier}`)
  }
})

test('tiers are roughly balanced (each >= 20%)', () => {
  const counts = { Trivial: 0, Routine: 0, Hard: 0 }
  for (const item of dataset) counts[item.expectedTier]++
  for (const tier of Object.keys(counts)) {
    const ratio = counts[tier] / dataset.length
    assert.ok(ratio >= 0.2, `${tier} is underrepresented: ${(ratio * 100).toFixed(0)}%`)
  }
})
