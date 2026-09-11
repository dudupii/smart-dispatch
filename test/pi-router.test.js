import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPiRouter } from '../src/pi-router.js'
import { hashPrompt } from '../src/escalation.js'

const BASE = { provider: 'anthropic', id: 'claude-opus-4-5' }
const HAIKU = { provider: 'anthropic', id: 'claude-haiku-4-5' }
const key = (m) => `${m.provider}/${m.id}`

// A pi-like ctx: current model + fuzzy model registry, recording setModel calls.
// The router resolves a canonical slot to its provider wire name before the
// registry lookup (light → 'haiku' for the anthropic provider), so findable
// is keyed by wire names.
function fakeCtx({ current = BASE, findable = { haiku: HAIKU } } = {}) {
  const calls = []
  return {
    calls,
    ctx: {
      model: current,
      modelRegistry: { find: (provider, pattern) => findable[pattern] ?? null },
    },
    setModel: async (m) => calls.push(key(m)),
  }
}

function router(overrides = {}) {
  const { setModel, logEntry, readEntries, nowMs, config, ...rest } = overrides
  return createPiRouter({
    // Default injected resolver finds nothing — realistic tests resolve through
    // ctx.modelRegistry; the "unresolvable" case wants both sources null.
    findModel: () => null,
    setModel: setModel ?? (async () => {}),
    logEntry: logEntry ?? (() => {}),
    readEntries: readEntries ?? (() => []),
    nowMs: nowMs ?? Date.now(),
    config: config ?? {},
    ...rest,
  })
}

test('confident trivial prompt steps the session down for this loop', async () => {
  const fx = fakeCtx()
  const r = router({ setModel: fx.setModel })
  const d = await r.onPrompt('list all files in the src directory', fx.ctx)
  assert.equal(d.rewrite, 'light', 'decision speaks canonical slots')
  assert.deepEqual(fx.calls, [key(HAIKU)], 'resolved through the provider wire name')
})

test('a hard first prompt changes nothing — base model is the ceiling', async () => {
  const fx = fakeCtx()
  const r = router({ setModel: fx.setModel })
  await r.onPrompt('design a caching layer for the router', fx.ctx)
  assert.deepEqual(fx.calls, [], 'never escalates above base, never touches same-model')
})

test('after a downgrade, the next hard prompt restores the base model', async () => {
  const fx = fakeCtx({ current: HAIKU }) // session currently left on haiku
  const calls = []
  const r = router({ setModel: async (m) => calls.push(key(m)) })
  // first prompt fixes the base — hard prompt: base is already restored
  await r.onPrompt('refactor the dispatch pipeline', fx.ctx)
  assert.deepEqual(calls, [], 'already on base, nothing to do')
})

test('downgrade then restore round-trip', async () => {
  const calls = []
  let current = BASE
  const r = router({ setModel: async (m) => { calls.push(key(m)); current = m } })
  const baseCtx = () => ({ model: current, modelRegistry: { find: (p, a) => ({ haiku: HAIKU }[a] ?? null) } })
  await r.onPrompt('list all files in the src directory', baseCtx())      // → haiku
  await r.onPrompt('now implement a new feature and write tests', baseCtx()) // hard → restore base
  assert.deepEqual(calls, [key(HAIKU), key(BASE)])
})

test('user model selection (set/cycle) pins routing off; restore does not', async () => {
  const fx = fakeCtx()
  const r = router({ setModel: fx.setModel })
  r.onModelSelect('restore', { provider: BASE.provider, id: BASE.id })
  await r.onPrompt('list all files in the src directory', fx.ctx)
  assert.deepEqual(fx.calls, [key(HAIKU)], 'restore is not a user pin — routing still active')

  r.onModelSelect('set', HAIKU)
  await r.onPrompt('list all files in the src directory again please', fx.ctx)
  assert.deepEqual(fx.calls, [key(HAIKU)], 'after /model, routing stands down entirely')
  assert.equal(r.isPinned(), true)
})

test('tier alias not resolvable in the registry → stay put (safe direction)', async () => {
  const fx = fakeCtx({ findable: {} }) // host registry can't resolve the alias
  const r = router({ setModel: fx.setModel }) // injected resolver also finds nothing
  const d = await r.onPrompt('list all files in the src directory', fx.ctx)
  assert.equal(d.rewrite, 'light')
  assert.deepEqual(fx.calls, [], 'no concrete model found — never force a guess')
})

test('retry of a downgraded prompt restores the base and logs the Retry', async () => {
  const prompt = 'list all files in the src directory'
  const logged = []
  const calls = []
  let current = BASE
  const logEntries = [] // what readEntries sees — filled after the downgrade below
  const r = router({
    setModel: async (m) => { calls.push(key(m)); current = m },
    readEntries: () => logEntries,
    logEntry: (e) => logged.push(e),
  })
  const ctx = () => ({ model: current, modelRegistry: { find: (p, a) => ({ haiku: HAIKU }[a] ?? null) } })

  // 1. hard prompt first — fixes the base at the session ceiling
  await r.onPrompt('refactor the dispatch pipeline', ctx())
  // 2. trivial prompt — steps down to haiku; its log entry becomes the history
  await r.onPrompt(prompt, ctx())
  const downgrade = logged.at(-1)
  assert.ok(downgrade.hash, 'downgrade logged its hash')
  // legacy-vocabulary history entry (pre-v0.5.0) — must still match
  logEntries.push({ ts: new Date(Date.now() - 60_000).toISOString(), model: 'haiku', hash: downgrade.hash })

  // 3. same prompt again within the window — self-heal restores the base
  const d = await r.onPrompt(prompt, ctx())
  assert.equal(d.escalatedFrom, 'haiku')
  assert.deepEqual(calls, [key(HAIKU), key(BASE)])
  const retry = logged.find((e) => e.tier === 'Retry')
  assert.ok(retry, 'Retry entry logged')
  assert.equal(retry.host, 'pi')
})
