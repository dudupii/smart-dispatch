import { test } from 'node:test'
import * as assert from 'node:assert'
import { parseRouterOutput } from '../src/parse-router-output.js'

// The router agent may answer in either vocabulary; parseRouterOutput accepts
// canonical slots (light/mid/heavy) and legacy aliases (haiku/sonnet/opus),
// always returning the canonical slot.
test('valid JSON object (canonical slots)', () => {
  const r = parseRouterOutput('{"tier":"Trivial","model":"light","confidence":0.9,"reason":"grep"}')
  assert.deepEqual(r, { tier: 'Trivial', model: 'light', confidence: 0.9, reason: 'grep' })
})
test('valid JSON object (legacy aliases canonicalized)', () => {
  const r = parseRouterOutput('{"tier":"Trivial","model":"haiku","confidence":0.9,"reason":"grep"}')
  assert.deepEqual(r, { tier: 'Trivial', model: 'light', confidence: 0.9, reason: 'grep' })
})
test('JSON embedded in prose', () => {
  const r = parseRouterOutput('Sure! {"tier":"Hard","model":"opus","confidence":0.95,"reason":"design"} hope that helps')
  assert.equal(r.tier, 'Hard')
  assert.equal(r.model, 'heavy')
})
test('missing reason still parses (reason defaults to empty)', () => {
  const r = parseRouterOutput('{"tier":"Routine","model":"sonnet","confidence":0.82}')
  assert.equal(r.reason, '')
  assert.equal(r.model, 'mid')
})
test('invalid tier → null', () => {
  assert.equal(parseRouterOutput('{"tier":"Easy","model":"light","confidence":0.9}'), null)
})
test('invalid model → null', () => {
  assert.equal(parseRouterOutput('{"tier":"Trivial","model":"gpt4","confidence":0.9}'), null)
})
test('confidence out of range → null', () => {
  assert.equal(parseRouterOutput('{"tier":"Trivial","model":"light","confidence":1.5}'), null)
})
test('confidence missing → null', () => {
  assert.equal(parseRouterOutput('{"tier":"Trivial","model":"light"}'), null)
})
test('no JSON at all → null', () => {
  assert.equal(parseRouterOutput('I think this is trivial'), null)
})
test('non-string input → null', () => {
  assert.equal(parseRouterOutput(123), null)
})
test('two JSON-looking blocks → returns the valid complete one, skips incomplete', () => {
  const r = parseRouterOutput('Schema: {"tier":"Trivial"} Answer: {"tier":"Hard","model":"heavy","confidence":0.9,"reason":"design"}')
  assert.equal(r.tier, 'Hard')
  assert.equal(r.model, 'heavy')
})
test('first candidate invalid, second valid → returns second', () => {
  const r = parseRouterOutput('noise {"tier":"Easy"} then {"tier":"Routine","model":"mid","confidence":0.82}')
  assert.equal(r.tier, 'Routine')
})
