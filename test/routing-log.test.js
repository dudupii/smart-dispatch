import { test } from 'node:test'
import * as assert from 'node:assert'
import { parseLog, summarizeEntries } from '../src/routing-log.js'

test('parseLog: valid JSONL lines become entries', () => {
  const text =
    '{"ts":"2026-07-16T00:00:00Z","tier":"Trivial","confidence":0.92,"model":"haiku"}\n' +
    '{"ts":"2026-07-16T00:00:01Z","tier":"Hard","confidence":0.99,"model":"opus"}\n'
  assert.equal(parseLog(text).length, 2)
})

test('parseLog: skips malformed and blank lines', () => {
  const text =
    '{"tier":"Trivial","model":"haiku"}\n' +
    'not json at all\n' +
    '\n' +
    '{"tier":"Hard","model":"opus"}\n'
  const entries = parseLog(text)
  assert.equal(entries.length, 2)
  assert.deepEqual(entries.map((e) => e.model), ['haiku', 'opus'])
})

test('parseLog: skips entries without a model field', () => {
  const text = '{"tier":"Trivial"}\n{"tier":"Hard","model":"opus"}\n'
  const entries = parseLog(text)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].model, 'opus')
})

test('parseLog: empty / non-string input → []', () => {
  assert.deepEqual(parseLog(''), [])
  assert.deepEqual(parseLog(null), [])
})

test('summarizeEntries: empty → zeroed report', () => {
  const s = summarizeEntries([])
  assert.equal(s.count, 0)
  assert.deepEqual(s.byModel, {})
  assert.equal(s.savingsRate, null)
  assert.equal(s.hardDowngraded, null)
  assert.deepEqual(s.recent, [])
})

test('summarizeEntries: model breakdown + savings', () => {
  const s = summarizeEntries([
    { tier: 'Trivial', model: 'haiku' },
    { tier: 'Hard', model: 'opus' },
  ])
  assert.equal(s.count, 2)
  assert.deepEqual(s.byModel, { haiku: 1, opus: 1 })
  // actual 0.1 + 1.0 = 1.1 vs baseline 2.0 → 0.45
  assert.equal(s.savingsRate, 0.45)
  assert.equal(s.hardDowngraded, 0) // the one Hard task stayed on opus
})

test('summarizeEntries: Hard task downgraded shows in hardDowngraded', () => {
  const s = summarizeEntries([{ tier: 'Hard', model: 'sonnet' }])
  assert.equal(s.hardDowngraded, 1) // budget-mode style downgrade
})

test('summarizeEntries: recent caps at last 10', () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({ tier: 'Trivial', model: 'haiku', ts: String(i) }))
  const s = summarizeEntries(entries)
  assert.equal(s.recent.length, 10)
  assert.equal(s.recent[0].ts, '2') // dropped the first two
})
