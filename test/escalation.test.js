import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPrompt, shouldEscalate } from '../src/escalation.js'

const NOW = Date.parse('2026-09-02T12:00:00Z')
const HASH = hashPrompt({ prompt: 'find all usages of X' })

test('hashPrompt: deterministic, whitespace-insensitive, combines description', () => {
  assert.equal(
    hashPrompt({ prompt: 'find all\nusages   of X' }),
    hashPrompt({ prompt: 'find all usages of X' }),
  )
  assert.equal(hashPrompt({ prompt: 'the task', description: 'explore' }), hashPrompt({ prompt: 'the task', description: 'explore' }))
  assert.notEqual(hashPrompt({ prompt: 'find all usages of X' }), hashPrompt({ prompt: 'find all usages of Y' }))
  assert.ok(/^[0-9a-f]{10}$/.test(HASH))
})

test('hashPrompt: empty input → null (nothing to match on)', () => {
  assert.equal(hashPrompt({}), null)
  assert.equal(hashPrompt({ prompt: '   ', description: '' }), null)
})

// Legacy-vocabulary entries (pre-v0.5.0 logs say haiku/sonnet/opus) and
// canonical slot entries (light/mid/heavy) must both match — the shared log
// spans the upgrade.
test('shouldEscalate: recent below-heavy dispatch of the same task → escalate (legacy entry)', () => {
  const r = shouldEscalate({
    entries: [{ ts: '2026-09-02T11:55:00Z', model: 'haiku', hash: HASH }],
    hash: HASH,
    nowMs: NOW,
    windowMinutes: 10,
  })
  assert.deepEqual(r, { escalate: true, fromModel: 'haiku' })
})

test('shouldEscalate: recent below-heavy dispatch → escalate (canonical entry)', () => {
  const r = shouldEscalate({
    entries: [{ ts: '2026-09-02T11:55:00Z', model: 'light', hash: HASH }],
    hash: HASH,
    nowMs: NOW,
    windowMinutes: 10,
  })
  assert.deepEqual(r, { escalate: true, fromModel: 'light' })
})

test('shouldEscalate: task previously on heavy → nothing to fix (both vocabularies)', () => {
  for (const model of ['opus', 'heavy']) {
    const r = shouldEscalate({
      entries: [{ ts: '2026-09-02T11:55:00Z', model, hash: HASH }],
      hash: HASH,
      nowMs: NOW,
      windowMinutes: 10,
    })
    assert.equal(r.escalate, false, `legacy 'opus' must canonicalize to heavy, not count as a downgrade`)
  }
})

test('shouldEscalate: outside the window → stale, not a retry', () => {
  const r = shouldEscalate({
    entries: [{ ts: '2026-09-02T11:00:00Z', model: 'haiku', hash: HASH }],
    hash: HASH,
    nowMs: NOW,
    windowMinutes: 10,
  })
  assert.equal(r.escalate, false)
})

test('shouldEscalate: different task hash → no match', () => {
  const r = shouldEscalate({
    entries: [{ ts: '2026-09-02T11:55:00Z', model: 'haiku', hash: 'deadbeef00' }],
    hash: HASH,
    nowMs: NOW,
    windowMinutes: 10,
  })
  assert.equal(r.escalate, false)
})

test('shouldEscalate: a dispatch after an escalation still withholds the downgrade', () => {
  // Third dispatch of the same task. The Retry entry itself (model opus,
  // escalatedFrom set) must not be treated as "already fine" — matching it
  // would return no-escalate and let the router hand the retried task back
  // to haiku. We fall through to the original downgrade and keep correcting.
  const r = shouldEscalate({
    entries: [
      { ts: '2026-09-02T11:50:00Z', model: 'haiku', hash: HASH },
      { ts: '2026-09-02T11:58:00Z', model: 'opus', hash: HASH, escalatedFrom: 'haiku' },
    ],
    hash: HASH,
    nowMs: NOW,
    windowMinutes: 10,
  })
  assert.deepEqual(r, { escalate: true, fromModel: 'haiku' })
})

test('shouldEscalate: newest matching entry wins (across vocabularies)', () => {
  const r = shouldEscalate({
    entries: [
      { ts: '2026-09-02T11:50:00Z', model: 'haiku', hash: HASH }, // older, legacy
      { ts: '2026-09-02T11:56:00Z', model: 'mid', hash: HASH }, // newest, canonical
    ],
    hash: HASH,
    nowMs: NOW,
    windowMinutes: 10,
  })
  assert.deepEqual(r, { escalate: true, fromModel: 'mid' })
})

test('shouldEscalate: undatable/garbage entries are ignored, never crash', () => {
  const r = shouldEscalate({
    entries: [
      { model: 'haiku', hash: HASH }, // no ts
      { ts: 'garbage', model: 'haiku', hash: HASH },
      null,
    ],
    hash: HASH,
    nowMs: NOW,
    windowMinutes: 10,
  })
  assert.equal(r.escalate, false)
  assert.deepEqual(shouldEscalate({ entries: null, hash: HASH }), { escalate: false, fromModel: null })
  assert.deepEqual(shouldEscalate({ entries: [], hash: null }), { escalate: false, fromModel: null })
})
