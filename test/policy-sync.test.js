// Policy sync guard: workflows/batch-route.js INLINES the policy (workflow
// scripts run in a sandbox and cannot import src/). Nothing enforces that the
// copy stays faithful to src/decide-model.js — until now. This test:
//   1. extracts the threshold/floor literals from both files and asserts they match, and
//   2. runs the workflow's extracted `chooseModel` in a vm sandbox against the
//      same test vectors as decideModel, asserting identical behavior —
//      including the budget branch (the one place the two legitimately differ
//      in *mechanism*: fraction here, absolute budget there, same semantics).
// If this test fails, someone changed the policy in one place only.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { decideModel, DOWNGRADE_THRESHOLD, BUDGET_FLOOR } from '../src/decide-model.js'

const workflowSrc = readFileSync(
  fileURLToPath(new URL('../workflows/batch-route.js', import.meta.url)),
  'utf8',
)

function extractNumber(name) {
  const m = workflowSrc.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9.]+)`))
  assert.ok(m, `${name} not found in workflows/batch-route.js`)
  return Number(m[1])
}

// The function body ends at the first column-0 `}` — inner braces are indented.
const fnMatch = workflowSrc.match(/function chooseModel[\s\S]*?\n}/)
assert.ok(fnMatch, 'chooseModel not found in workflows/batch-route.js')

// The function body references the const declarations above it — carry those
// into the sandbox too, so we evaluate exactly the workflow's own copy.
const policyBlock =
  workflowSrc.match(new RegExp('const\\s+DOWNGRADE_THRESHOLD\\s*=\\s*[0-9.]+;?'))[0] + '\n' +
  workflowSrc.match(new RegExp('const\\s+BUDGET_FLOOR\\s*=\\s*[0-9.]+;?'))[0] + '\n' +
  fnMatch[0]

/** Evaluate the extracted chooseModel with the given `budget` global. */
function workflowChooseModel(budget, tier, confidence) {
  const ctx = vm.createContext({ budget })
  vm.runInContext(policyBlock, ctx)
  return ctx.chooseModel(tier, confidence)
}

const BUDGET_OFF = { total: null, remaining: () => 0 }

test('workflow inlines the same DOWNGRADE_THRESHOLD / BUDGET_FLOOR as decide-model.js', () => {
  assert.equal(extractNumber('DOWNGRADE_THRESHOLD'), DOWNGRADE_THRESHOLD)
  assert.equal(extractNumber('BUDGET_FLOOR'), BUDGET_FLOOR)
})

test('workflow chooseModel agrees with decideModel on the quality-first vectors', () => {
  const vectors = [
    ['Trivial', 0.9],   // confident trivial → haiku
    ['Routine', 0.85],  // confident routine → sonnet
    ['Hard', 0.99],     // hard → opus
    ['Unknown', 0.9],   // uncertain → opus
    ['Trivial', 0.7],   // not confident → opus
    ['Trivial', 0.8],   // exact boundary → downgrade
    ['Trivial', NaN],   // garbage confidence → opus
    [null, 0.9],        // missing tier → opus
  ]
  for (const [tier, confidence] of vectors) {
    const expected = decideModel({ tier, confidence }).model
    const actual = workflowChooseModel(BUDGET_OFF, tier, confidence)
    assert.equal(actual, expected, `chooseModel(${tier}, ${confidence}) diverged`)
  }
})

test('workflow budget branch matches decideModel budgetRemaining semantics', () => {
  // fraction here vs absolute budget there — same 10% floor, same direction.
  const cases = [
    // [decideModel budgetRemaining, workflow {total, remaining()}]
    [{ tier: 'Hard', confidence: 0.99, budgetRemaining: 0.05 }, { total: 100, remaining: () => 5 }],
    [{ tier: 'Hard', confidence: 0.99, budgetRemaining: 0.5 }, { total: 100, remaining: () => 50 }],
    // budget never escalates a confident downgrade back up
    [{ tier: 'Trivial', confidence: 0.9, budgetRemaining: 0.01 }, { total: 100, remaining: () => 1 }],
  ]
  for (const [input, budget] of cases) {
    const expected = decideModel(input).model
    const actual = workflowChooseModel(budget, input.tier, input.confidence)
    assert.equal(actual, expected)
  }
})
