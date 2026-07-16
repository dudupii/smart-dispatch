// Plugin integrity smoke test — the CI-runnable counterpart to
// `claude plugin validate`. Verifies the plugin is well-formed and that the
// prose in SKILL.md / README has not drifted from the code's constants.
import { test } from 'node:test'
import * as assert from 'node:assert'
import { readFileSync } from 'node:fs'
import {
  DOWNGRADE_THRESHOLD,
  BUDGET_FLOOR,
  decideModel,
} from '../src/decide-model.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0

test('plugin manifest (.claude-plugin/plugin.json) is valid with required fields', () => {
  const manifest = JSON.parse(read('../.claude-plugin/plugin.json'))
  assert.ok(isNonEmptyString(manifest.name), 'name')
  assert.ok(isNonEmptyString(manifest.version), 'version')
  assert.ok(isNonEmptyString(manifest.description), 'description')
  assert.equal(manifest.license, 'MIT')
})

test('marketplace manifest lists smart-dispatch pointing at ./', () => {
  const m = JSON.parse(read('../.claude-plugin/marketplace.json'))
  assert.ok(Array.isArray(m.plugins) && m.plugins.length > 0)
  const entry = m.plugins.find((p) => p.name === 'smart-dispatch')
  assert.ok(entry, 'smart-dispatch must be listed in the marketplace')
  assert.equal(entry.source, './')
})

test('SKILL.md has name + description frontmatter', () => {
  const skill = read('../skills/smart-dispatch/SKILL.md')
  const close = skill.indexOf('---', 4) // end of opening frontmatter
  const frontmatter = skill.slice(0, close)
  assert.match(frontmatter, /name:\s*smart-dispatch/)
  assert.match(frontmatter, /description:/)
})

test('SKILL.md policy numbers match the code (no drift)', () => {
  const skill = read('../skills/smart-dispatch/SKILL.md')
  assert.ok(
    skill.includes(String(DOWNGRADE_THRESHOLD)),
    `SKILL.md must reference the downgrade threshold ${DOWNGRADE_THRESHOLD}`
  )
  assert.ok(
    skill.includes(String(BUDGET_FLOOR)),
    `SKILL.md must reference the budget floor ${BUDGET_FLOOR}`
  )
})

test('all READMEs tuning knobs match the code (no drift)', () => {
  for (const file of ['../README.md', '../README.zh-Hans.md', '../README.zh-Hant.md', '../README.ja.md']) {
    const content = read(file)
    assert.ok(
      content.includes(String(DOWNGRADE_THRESHOLD)),
      `${file} must reference the downgrade threshold ${DOWNGRADE_THRESHOLD}`
    )
    assert.ok(
      content.includes(String(BUDGET_FLOOR)),
      `${file} must reference the budget floor ${BUDGET_FLOOR}`
    )
  }
})

test('policy sanity check (guards against accidental policy change)', () => {
  assert.equal(decideModel({ tier: 'Hard', confidence: 0.99 }).model, 'opus')
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.9 }).model, 'haiku')
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.5 }).model, 'opus')
})
