import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js'

function withTempConfig(contents, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sd-config-'))
  const path = join(dir, 'config.json')
  try {
    if (contents !== null) writeFileSync(path, contents)
    return fn(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('no file, no env → defaults', () => {
  withTempConfig(null, (path) => {
    const c = loadConfig({ env: { SMART_DISPATCH_CONFIG: path + '-missing' } })
    assert.equal(c.downgradeThreshold, DEFAULT_CONFIG.downgradeThreshold)
    assert.equal(c.budgetFloor, DEFAULT_CONFIG.budgetFloor)
    assert.equal(c.escalation.enabled, true)
    assert.deepEqual(c.agentOverrides, {})
    assert.equal(c.priceTable, null)
  })
})

test('config file overrides defaults; invalid values fall back per-field', () => {
  withTempConfig(
    JSON.stringify({
      downgradeThreshold: 0.9,
      budgetFloor: 'not-a-number',
      escalation: { windowMinutes: 5 },
      agentOverrides: { 'file-finder': 'haiku', '': 'opus', careful: 42 },
    }),
    (path) => {
      const c = loadConfig({ env: { SMART_DISPATCH_CONFIG: path } })
      assert.equal(c.downgradeThreshold, 0.9)
      assert.equal(c.budgetFloor, DEFAULT_CONFIG.budgetFloor) // invalid → default
      assert.equal(c.escalation.windowMinutes, 5)
      assert.deepEqual(c.agentOverrides, { 'file-finder': 'haiku' }) // junk entries dropped
    },
  )
})

test('malformed JSON file never throws → defaults stand', () => {
  withTempConfig('{ this is not json', (path) => {
    const c = loadConfig({ env: { SMART_DISPATCH_CONFIG: path } })
    assert.equal(c.downgradeThreshold, DEFAULT_CONFIG.downgradeThreshold)
  })
})

test('env beats file; both beat defaults', () => {
  withTempConfig(JSON.stringify({ downgradeThreshold: 0.9 }), (path) => {
    const c = loadConfig({
      env: { SMART_DISPATCH_CONFIG: path, SMART_DISPATCH_THRESHOLD: '0.7' },
    })
    assert.equal(c.downgradeThreshold, 0.7)
    const fileOnly = loadConfig({ env: { SMART_DISPATCH_CONFIG: path } })
    assert.equal(fileOnly.downgradeThreshold, 0.9)
  })
})

test('fractions are clamped into [0,1]; garbage env values ignored', () => {
  const c = loadConfig({ env: { SMART_DISPATCH_THRESHOLD: '5', SMART_DISPATCH_BUDGET_FLOOR: 'x' } })
  assert.equal(c.downgradeThreshold, 1)
  assert.equal(c.budgetFloor, DEFAULT_CONFIG.budgetFloor)
})

test('escalation kill switch via env', () => {
  for (const v of ['0', 'false', 'off', 'no']) {
    const c = loadConfig({ env: { SMART_DISPATCH_ESCALATION: v } })
    assert.equal(c.escalation.enabled, false, `SMART_DISPATCH_ESCALATION=${v} should disable`)
  }
  const on = loadConfig({ env: { SMART_DISPATCH_ESCALATION: '1' } })
  assert.equal(on.escalation.enabled, true)
})

test('priceTable accepted only when all three models are present and positive', () => {
  withTempConfig(JSON.stringify({ priceTable: { haiku: 0.2, sonnet: 0.4, opus: 1 } }), (path) => {
    const c = loadConfig({ env: { SMART_DISPATCH_CONFIG: path } })
    assert.deepEqual(c.priceTable, { haiku: 0.2, sonnet: 0.4, opus: 1 })
  })
  withTempConfig(JSON.stringify({ priceTable: { haiku: 0.2, sonnet: 0.4 } }), (path) => {
    const c = loadConfig({ env: { SMART_DISPATCH_CONFIG: path } })
    assert.equal(c.priceTable, null) // partial table would skew savings
  })
})
