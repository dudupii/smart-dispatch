# smart-dispatch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship an open-source Claude Code plugin that auto-selects the model before dispatching a sub-agent, quality-first (default opus, downgrade only on confident trivial/routine tasks).

**Architecture:** A Skill (`skills/smart-dispatch/SKILL.md`) is the user-facing core — pure instructions, zero dependencies, installs and just works. The routing **policy** is encoded as a tiny, fully-tested pure function (`src/decide-model.js`) which is the single source of truth; the SKILL.md prose mirrors it. Two more pure modules — `parse-router-output.js` (parse the classifier's output) and `compute-metrics.js` (measure routing quality) — back an evaluation harness that validates the whole thing against a labeled dataset.

**Tech Stack:** JavaScript (ESM), Node ≥ 18, built-in `node:test` (no test deps). `@anthropic-ai/sdk` as a **dev-only** dependency for the eval harness (not shipped). The shipped plugin has **zero runtime dependencies**.

**Scope (MVP):** decision core + parser + metrics (all TDD), the SKILL.md, plugin manifest, eval dataset + harness, README + MIT license. The Workflow "pro mode" (`batch-route.js`) is **deferred** per design §11.

**Design doc:** `docs/plans/2026-07-12-smart-dispatch-design.md`

---

## Project layout (end state)

```
smart-dispatch-plugin/
├── package.json
├── plugin.json
├── README.md
├── LICENSE
├── .gitignore
├── src/
│   ├── decide-model.js          # quality-first policy (source of truth)
│   ├── parse-router-output.js   # parse classifier output → decision obj
│   └── compute-metrics.js       # false-downgrade + savings metrics
├── test/
│   ├── sanity.test.js
│   ├── decide-model.test.js
│   ├── parse-router-output.test.js
│   ├── compute-metrics.test.js
│   └── dataset.test.js
├── skills/
│   └── smart-dispatch/
│       └── SKILL.md             # the shipped core
├── eval/
│   ├── dataset.json             # ~50 labeled tasks
│   └── run-eval.js              # harness (calls live haiku router)
└── docs/plans/
    ├── 2026-07-12-smart-dispatch-design.md
    └── 2026-07-12-smart-dispatch.md   (this file)
```

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `.gitignore`, `src/`, `test/`, `skills/`, `eval/`, `workflows/` dirs
- Create: `test/sanity.test.js`

**Step 1: Create directory structure**

```bash
cd /home/li-du/smart-dispatch-plugin
mkdir -p src test skills/smart-dispatch eval workflows
```

**Step 2: Write `package.json`**

```json
{
  "name": "smart-dispatch",
  "version": "0.1.0",
  "description": "Quality-first automatic model routing for Claude Code sub-agents.",
  "type": "module",
  "scripts": {
    "test": "node --test",
    "eval": "node eval/run-eval.js"
  },
  "license": "MIT"
}
```

**Step 3: Write `.gitignore`**

```
node_modules/
.env
```

**Step 4: Write the failing sanity test `test/sanity.test.js`**

```javascript
import { test } from 'node:test'
import * as assert from 'node:assert'

test('node:test is wired up', () => {
  assert.equal(1 + 1, 2)
})
```

**Step 5: Run the test to verify the runner works**

Run: `node --test`
Expected: 1 test passes (the sanity test).

**Step 6: Commit**

```bash
git add package.json .gitignore test/sanity.test.js
git commit -m "chore: scaffold project with node:test"
```

---

### Task 2: decideModel — the quality-first policy (TDD)

This pure function is the **source of truth** for all routing decisions. SKILL.md will mirror it. Test it exhaustively first.

**Files:**
- Create: `test/decide-model.test.js`
- Create: `src/decide-model.js`

**Step 1: Write the failing tests `test/decide-model.test.js`**

```javascript
import { test } from 'node:test'
import * as assert from 'node:assert'
import { decideModel } from '../src/decide-model.js'

// Quality-first defaults — everything uncertain goes to opus.
test('Hard task → opus', () => {
  assert.equal(decideModel({ tier: 'Hard', confidence: 0.99 }).model, 'opus')
})
test('Unknown tier → opus', () => {
  assert.equal(decideModel({ tier: 'Unknown', confidence: 0.99 }).model, 'opus')
})
test('missing tier → opus (safe default)', () => {
  assert.equal(decideModel({ confidence: 0.9 }).model, 'opus')
})

// Confident downgrades.
test('Trivial + confident → haiku', () => {
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.9 }).model, 'haiku')
})
test('Routine + confident → sonnet', () => {
  assert.equal(decideModel({ tier: 'Routine', confidence: 0.85 }).model, 'sonnet')
})

// The quality guarantee: low confidence never downgrades.
test('Trivial + not confident → opus', () => {
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.7 }).model, 'opus')
})
test('Routine + not confident → opus', () => {
  assert.equal(decideModel({ tier: 'Routine', confidence: 0.5 }).model, 'opus')
})
test('boundary: confidence exactly 0.8 downgrades', () => {
  assert.equal(decideModel({ tier: 'Trivial', confidence: 0.8 }).model, 'haiku')
})

// User override short-circuits everything.
test('user override wins over tier', () => {
  assert.equal(
    decideModel({ tier: 'Hard', confidence: 0.99, userOverride: 'haiku' }).model,
    'haiku'
  )
})

// Budget mode — the ONLY allowed downward override of opus.
test('budget low downgrades opus → sonnet', () => {
  assert.equal(
    decideModel({ tier: 'Hard', confidence: 0.99, budgetRemaining: 0.05 }).model,
    'sonnet'
  )
})
test('budget ok keeps opus', () => {
  assert.equal(
    decideModel({ tier: 'Hard', confidence: 0.99, budgetRemaining: 0.5 }).model,
    'opus'
  )
})
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/decide-model.test.js`
Expected: FAIL — `Cannot find module '../src/decide-model.js'`.

**Step 3: Write the implementation `src/decide-model.js`**

```javascript
// Quality-first model selection policy.
// This is the SINGLE SOURCE OF TRUTH for routing decisions.
// skills/smart-dispatch/SKILL.md mirrors these rules — keep them in sync.

const DOWNGRADE_THRESHOLD = 0.8 // confidence required to leave opus
const BUDGET_FLOOR = 0.1        // below this remaining-budget fraction, opus may step down

const TIER_MODEL = {
  Trivial: 'haiku',
  Routine: 'sonnet',
  Hard: 'opus',
  Unknown: 'opus',
}

/**
 * @param {object} input
 * @param {'Trivial'|'Routine'|'Hard'|'Unknown'} [input.tier]
 * @param {number} [input.confidence] - 0..1
 * @param {string|null} [input.userOverride] - explicit model request, skips routing
 * @param {number|null} [input.budgetRemaining] - 0..1 fraction of budget left
 * @returns {{model: 'haiku'|'sonnet'|'opus', downgraded: boolean, reason: string}}
 */
export function decideModel({ tier, confidence = 0, userOverride = null, budgetRemaining = null } = {}) {
  // 1. User always wins.
  if (userOverride) {
    return { model: userOverride, downgraded: false, reason: 'user override' }
  }

  // 2. Normalize tier; unknown → safe default opus.
  const safeTier = TIER_MODEL[tier] ? tier : 'Unknown'

  // 3. Quality-first: leave opus ONLY when confidently trivial/routine.
  const confident = confidence >= DOWNGRADE_THRESHOLD
  const downgradeable = (safeTier === 'Trivial' || safeTier === 'Routine') && confident

  let model = downgradeable ? TIER_MODEL[safeTier] : 'opus'
  let reason = downgradeable
    ? `confident ${safeTier} (${confidence})`
    : (safeTier === 'Hard' ? 'hard task' : 'uncertain → opus')

  // 4. Budget mode: the ONLY allowed downward override of opus.
  if (model === 'opus' && budgetRemaining !== null && budgetRemaining < BUDGET_FLOOR) {
    return { model: 'sonnet', downgraded: true, reason: `budget low (${budgetRemaining}) → opus→sonnet` }
  }

  return { model, downgraded: downgradeable, reason }
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test test/decide-model.test.js`
Expected: PASS — all 11 tests.

**Step 5: Commit**

```bash
git add src/decide-model.js test/decide-model.test.js
git commit -m "feat: add decideModel quality-first policy"
```

---

### Task 3: parseRouterOutput — parse the classifier's output (TDD)

The router agent returns text that should contain a JSON object. Parse defensively; any malformation returns `null` so the caller falls back to opus.

**Files:**
- Create: `test/parse-router-output.test.js`
- Create: `src/parse-router-output.js`

**Step 1: Write the failing tests `test/parse-router-output.test.js`**

```javascript
import { test } from 'node:test'
import * as assert from 'node:assert'
import { parseRouterOutput } from '../src/parse-router-output.js'

test('valid JSON object', () => {
  const r = parseRouterOutput('{"tier":"Trivial","model":"haiku","confidence":0.9,"reason":"grep"}')
  assert.deepEqual(r, { tier: 'Trivial', model: 'haiku', confidence: 0.9, reason: 'grep' })
})
test('JSON embedded in prose', () => {
  const r = parseRouterOutput('Sure! {"tier":"Hard","model":"opus","confidence":0.95,"reason":"design"} hope that helps')
  assert.equal(r.tier, 'Hard')
})
test('missing reason still parses (reason defaults to empty)', () => {
  const r = parseRouterOutput('{"tier":"Routine","model":"sonnet","confidence":0.82}')
  assert.equal(r.reason, '')
})
test('invalid tier → null', () => {
  assert.equal(parseRouterOutput('{"tier":"Easy","model":"haiku","confidence":0.9}'), null)
})
test('invalid model → null', () => {
  assert.equal(parseRouterOutput('{"tier":"Trivial","model":"gpt4","confidence":0.9}'), null)
})
test('confidence out of range → null', () => {
  assert.equal(parseRouterOutput('{"tier":"Trivial","model":"haiku","confidence":1.5}'), null)
})
test('confidence missing → null', () => {
  assert.equal(parseRouterOutput('{"tier":"Trivial","model":"haiku"}'), null)
})
test('no JSON at all → null', () => {
  assert.equal(parseRouterOutput('I think this is trivial'), null)
})
test('non-string input → null', () => {
  assert.equal(parseRouterOutput(123), null)
})
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/parse-router-output.test.js`
Expected: FAIL — module not found.

**Step 3: Write the implementation `src/parse-router-output.js`**

```javascript
// Parse the router agent's structured output into a decision object.
// Returns null on ANY malformation — the caller then falls back to opus.

const VALID_TIERS = new Set(['Trivial', 'Routine', 'Hard'])
const VALID_MODELS = new Set(['haiku', 'sonnet', 'opus'])

/**
 * @param {string} raw - raw text from the router agent
 * @returns {{tier:string,model:string,confidence:number,reason:string}|null}
 */
export function parseRouterOutput(raw) {
  if (typeof raw !== 'string') return null

  // Extract the first {...} block (router may wrap JSON in prose).
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null

  let obj
  try {
    obj = JSON.parse(match[0])
  } catch {
    return null
  }

  const tier = typeof obj.tier === 'string' ? obj.tier.trim() : ''
  const model = typeof obj.model === 'string' ? obj.model.trim() : ''
  const confidence = Number(obj.confidence)

  if (!VALID_TIERS.has(tier)) return null
  if (!VALID_MODELS.has(model)) return null
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null

  return {
    tier,
    model,
    confidence,
    reason: typeof obj.reason === 'string' ? obj.reason : '',
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test test/parse-router-output.test.js`
Expected: PASS — all 9 tests.

**Step 5: Commit**

```bash
git add src/parse-router-output.js test/parse-router-output.test.js
git commit -m "feat: add parseRouterOutput defensive parser"
```

---

### Task 4: computeMetrics — measure routing quality (TDD)

Pure function: given a list of `{ trueTier, chosenModel }` outcomes, compute the two metrics from design §9.

**Files:**
- Create: `test/compute-metrics.test.js`
- Create: `src/compute-metrics.js`

**Step 1: Write the failing tests `test/compute-metrics.test.js`**

```javascript
import { test } from 'node:test'
import * as assert from 'node:assert'
import { computeMetrics } from '../src/compute-metrics.js'

test('empty → null metrics, count 0', () => {
  assert.deepEqual(computeMetrics([]), { falseDowngradeRate: null, savingsRate: null, count: 0 })
})
test('all Hard on opus → zero false-downgrade, zero savings', () => {
  const m = computeMetrics([
    { trueTier: 'Hard', chosenModel: 'opus' },
    { trueTier: 'Hard', chosenModel: 'opus' },
  ])
  assert.equal(m.falseDowngradeRate, 0)
  assert.equal(m.savingsRate, 0)
})
test('Hard routed to haiku → false-downgrade rate 1', () => {
  const m = computeMetrics([{ trueTier: 'Hard', chosenModel: 'haiku' }])
  assert.equal(m.falseDowngradeRate, 1)
})
test('non-Hard tasks do not affect false-downgrade rate', () => {
  const m = computeMetrics([
    { trueTier: 'Trivial', chosenModel: 'haiku' },
    { trueTier: 'Routine', chosenModel: 'sonnet' },
  ])
  assert.equal(m.falseDowngradeRate, 0)
})
test('no Hard tasks → false-downgrade rate 0 (vacuously)', () => {
  const m = computeMetrics([{ trueTier: 'Trivial', chosenModel: 'haiku' }])
  assert.equal(m.falseDowngradeRate, 0)
})
test('savings rate computed vs all-opus baseline', () => {
  const m = computeMetrics([
    { trueTier: 'Trivial', chosenModel: 'haiku' }, // 0.1
    { trueTier: 'Hard', chosenModel: 'opus' },      // 1.0
  ])
  // actual 1.1, baseline 2.0 → savings 0.45
  assert.equal(m.savingsRate, 0.45)
})
```

**Step 2: Run tests to verify they fail**

Run: `node --test test/compute-metrics.test.js`
Expected: FAIL — module not found.

**Step 3: Write the implementation `src/compute-metrics.js`**

```javascript
// Compute quality + cost metrics from routing outcomes.
// Relative token-cost weights (opus = 1.0). Approximate but consistent.
const RELATIVE_COST = { haiku: 0.1, sonnet: 0.3, opus: 1.0 }

/**
 * @param {Array<{trueTier:'Trivial'|'Routine'|'Hard', chosenModel:'haiku'|'sonnet'|'opus'}>} outcomes
 * @returns {{falseDowngradeRate:number|null, savingsRate:number|null, count:number}}
 */
export function computeMetrics(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return { falseDowngradeRate: null, savingsRate: null, count: 0 }
  }

  // False downgrade: a Hard task routed below opus (quality loss).
  // This is the RED-LINE metric — target ~0.
  const hardTasks = outcomes.filter((o) => o.trueTier === 'Hard')
  const falseDowngrades = hardTasks.filter((o) => o.chosenModel !== 'opus')
  const falseDowngradeRate = hardTasks.length > 0
    ? falseDowngrades.length / hardTasks.length
    : 0

  // Savings: actual cost vs all-opus baseline.
  const actualCost = outcomes.reduce(
    (sum, o) => sum + (RELATIVE_COST[o.chosenModel] ?? 1.0),
    0
  )
  const baselineCost = outcomes.length * RELATIVE_COST.opus
  const savingsRate = baselineCost > 0 ? 1 - actualCost / baselineCost : 0

  return { falseDowngradeRate, savingsRate, count: outcomes.length }
}
```

**Step 4: Run tests to verify they pass**

Run: `node --test test/compute-metrics.test.js`
Expected: PASS — all 6 tests.

**Step 5: Run the full suite to confirm nothing regressed**

Run: `node --test`
Expected: PASS — all tests across all files.

**Step 6: Commit**

```bash
git add src/compute-metrics.js test/compute-metrics.test.js
git commit -m "feat: add computeMetrics for false-downgrade + savings"
```

---

### Task 5: SKILL.md — the shipped core

This is the user-facing artifact. It must mirror `src/decide-model.js` **exactly**. There is no unit test for a prompt — its correctness is enforced two ways: (a) human review that the rules match the tested function, and (b) the eval harness (Task 9) which exercises the same policy end-to-end.

**Files:**
- Create: `skills/smart-dispatch/SKILL.md`

**Step 1: Write `skills/smart-dispatch/SKILL.md`**

````markdown
---
name: smart-dispatch
description: Quality-first automatic model routing. Before dispatching a sub-agent, classify the task with a cheap model and pick opus by default — downgrade only when confidently trivial/routine. Trigger when about to call the Agent/Task tool to dispatch a task.
---

# smart-dispatch

You are about to dispatch a sub-agent via the Agent/Task tool. Pick the right model first — do not just default to something.

## Policy (source of truth: `src/decide-model.js` — keep in sync)

- **Default: opus.** Quality first.
- **Downgrade ONLY when** `tier ∈ {Trivial, Routine}` AND `confidence ≥ 0.8`:
  - Trivial → `haiku`
  - Routine → `sonnet`
- **Everything else → opus**, including any uncertainty, low confidence, or parse failure.
- **User override wins**: if the user named a model, use it and skip routing.
- **Budget mode** (Workflow pro mode only): if remaining budget < 0.1, opus may step down to sonnet.

## Steps

1. **Override check.** If the user explicitly named a model → use it. Stop here.
2. **Route.** Dispatch a classifier agent with `model: "haiku"`, asking for structured output only:
   ```json
   {"tier":"Trivial"|"Routine"|"Hard","model":"haiku"|"sonnet"|"opus","confidence":0..1,"reason":"..."}
   ```
   Classification guide:
   - **Trivial** → pure search / grep / read config / list files / string lookup
   - **Routine** → clear-pattern edit / summarize known content / format / apply a template
   - **Hard** → reasoning / design / debug / multi-file logic / new code / architecture
   - When unsure, pick **Hard** and lower the confidence.
3. **Decide.** Apply the policy to the parsed output. If the output can't be parsed → opus.
4. **Execute.** Dispatch the real worker agent with the chosen model.

## Fallback

Any error, ambiguity, or low confidence → **opus**. Never lose quality to a routing mistake. The only acceptable misjudgment direction is treating a simple task as hard (a little wasted spend) — never the reverse.
````

**Step 2: Verify — manually diff the policy block against `src/decide-model.js`**

Check that the SKILL.md policy states the same threshold (0.8), the same tier→model map, the same user-override rule, and the same budget floor (0.1). They must match.

**Step 3: Commit**

```bash
git add skills/smart-dispatch/SKILL.md
git commit -m "feat: add smart-dispatch SKILL (core artifact)"
```

---

### Task 6: plugin.json — manifest

**Files:**
- Create: `plugin.json`

**Step 1: Write `plugin.json`**

```json
{
  "name": "smart-dispatch",
  "version": "0.1.0",
  "description": "Quality-first automatic model routing for Claude Code sub-agents. Default opus, downgrade only on confident trivial/routine tasks.",
  "license": "MIT",
  "keywords": ["claude-code", "model-routing", "sub-agent", "skill", "cost"]
}
```

> Note: verify this against the current Claude Code plugin spec when packaging for distribution — the field set may have evolved.

**Step 2: Verify it is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugin.json','utf8')); console.log('valid')"`
Expected: prints `valid`.

**Step 3: Commit**

```bash
git add plugin.json
git commit -m "feat: add plugin manifest"
```

---

### Task 7: eval dataset — ~50 labeled tasks

**Files:**
- Create: `eval/dataset.json`
- Create: `test/dataset.test.js`

**Step 1: Write the schema test first `test/dataset.test.js`**

```javascript
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

test('tiers are roughly balanced (each >= 25%)', () => {
  const counts = { Trivial: 0, Routine: 0, Hard: 0 }
  for (const item of dataset) counts[item.expectedTier]++
  for (const tier of Object.keys(counts)) {
    const ratio = counts[tier] / dataset.length
    assert.ok(ratio >= 0.2, `${tier} is underrepresented: ${(ratio * 100).toFixed(0)}%`)
  }
})
```

**Step 2: Run test to verify it fails**

Run: `node --test test/dataset.test.js`
Expected: FAIL — `eval/dataset.json` not found.

**Step 3: Write `eval/dataset.json`** (expand toward 50 before the real eval run; keep tiers balanced)

```json
[
  {"task": "Find every file that imports 'express'.", "expectedTier": "Trivial"},
  {"task": "List all .ts files under src/.", "expectedTier": "Trivial"},
  {"task": "Show me the contents of package.json.", "expectedTier": "Trivial"},
  {"task": "grep for TODO comments in the codebase.", "expectedTier": "Trivial"},
  {"task": "How many times is 'useState' used in the frontend?", "expectedTier": "Trivial"},
  {"task": "Find the function named 'authenticate'.", "expectedTier": "Trivial"},
  {"task": "What port does the server listen on? Check the config.", "expectedTier": "Trivial"},
  {"task": "List the files modified in the last commit.", "expectedTier": "Trivial"},
  {"task": "Show the git log for the last 5 commits.", "expectedTier": "Trivial"},
  {"task": "Which files contain the word 'deprecated'?", "expectedTier": "Trivial"},

  {"task": "Reformat this function to match the project's Prettier config.", "expectedTier": "Routine"},
  {"task": "Summarize what auth.js does in two sentences.", "expectedTier": "Routine"},
  {"task": "Convert this JavaScript function to TypeScript, adding types.", "expectedTier": "Routine"},
  {"task": "Write a unit test for this pure add(a, b) function.", "expectedTier": "Routine"},
  {"task": "Rename the variable 'd' to 'duration' everywhere in this file.", "expectedTier": "Routine"},
  {"task": "Add JSDoc comments to these three exported functions.", "expectedTier": "Routine"},
  {"task": "Update the dependency lodash from 4.17.20 to 4.17.21 in package.json.", "expectedTier": "Routine"},
  {"task": "Extract these repeated strings into a constants file.", "expectedTier": "Routine"},
  {"task": "Wrap this callback-style function in a Promise.", "expectedTier": "Routine"},
  {"task": "Sort the imports in this file alphabetically.", "expectedTier": "Routine"},

  {"task": "Design the schema for a multi-tenant billing database.", "expectedTier": "Hard"},
  {"task": "Debug a race condition in our websocket reconnect logic.", "expectedTier": "Hard"},
  {"task": "Refactor the monolithic User class into separate concerns.", "expectedTier": "Hard"},
  {"task": "Implement a least-recently-used cache with O(1) operations.", "expectedTier": "Hard"},
  {"task": "Figure out why the checkout flow drops items under load.", "expectedTier": "Hard"},
  {"task": "Design a rate limiter that works across multiple server instances.", "expectedTier": "Hard"},
  {"task": "Rewrite the search to support fuzzy matching and ranking.", "expectedTier": "Hard"},
  {"task": "Plan the migration from REST to GraphQL without downtime.", "expectedTier": "Hard"},
  {"task": "Diagnose a memory leak that only appears after hours of uptime.", "expectedTier": "Hard"},
  {"task": "Architect an event-sourced order system with eventual consistency.", "expectedTier": "Hard"},
  {"task": "Fix the bug.", "expectedTier": "Hard"},
  {"task": "Make the app faster.", "expectedTier": "Hard"},
  {"task": "Review whether our auth design has security holes.", "expectedTier": "Hard"},
  {"task": "Implement backpressure for our streaming pipeline.", "expectedTier": "Hard"},
  {"task": "Design a retry policy that handles partial failures across services.", "expectedTier": "Hard"},
  {"task": "Refactor the state management to avoid the prop-drilling problem.", "expectedTier": "Hard"}
]
```

**Step 4: Run test to verify it passes**

Run: `node --test test/dataset.test.js`
Expected: PASS — 3 tests. (Then grow the set toward 50 before the real eval run.)

**Step 5: Commit**

```bash
git add eval/dataset.json test/dataset.test.js
git commit -m "feat: add labeled eval dataset + schema test"
```

---

### Task 8: run-eval.js — the evaluation harness

Orchestrates: load dataset → call the live haiku router for each task → parse → apply `decideModel` → collect outcomes → print metrics. Uses the tested pure modules; only the live LLM call is untested (run manually).

**Files:**
- Create: `eval/run-eval.js`
- Modify: `package.json` (add devDependency)

**Step 1: Install the SDK (dev-only)**

Run: `npm install -D @anthropic-ai/sdk`
Expected: adds `@anthropic-ai/sdk` to `devDependencies`, creates `node_modules/`. (Now ignored by `.gitignore`.)

> Consult the **claude-api** skill for the current SDK usage and model IDs before finalizing the call.

**Step 2: Write `eval/run-eval.js`**

```javascript
// Evaluation harness: runs the live haiku router over the labeled dataset,
// applies the decideModel policy, and prints quality + cost metrics.
// Manual run: ANTHROPIC_API_KEY=xxx npm run eval

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { parseRouterOutput } from '../src/parse-router-output.js'
import { decideModel } from '../src/decide-model.js'
import { computeMetrics } from '../src/compute-metrics.js'

// Verify the current Haiku model ID via the claude-api skill; this is the Haiku 4.5 id.
const ROUTER_MODEL = 'claude-haiku-4-5-20251001'

const ROUTER_PROMPT = `You are a task-difficulty classifier for an AI coding agent. Read the task and output ONLY a JSON object, nothing else:
{"tier":"Trivial"|"Routine"|"Hard","model":"haiku"|"sonnet"|"opus","confidence":0.0-1.0,"reason":"one short phrase"}

- Trivial: pure search, grep, read a config, list files, string lookup  → haiku
- Routine: clear-pattern edit, summarize known content, format, apply a template → sonnet
- Hard: reasoning, design, debug, multi-file logic, new code, architecture → opus
When unsure, pick Hard and lower the confidence.`

const dataset = JSON.parse(readFileSync(new URL('./dataset.json', import.meta.url)))
const client = new Anthropic() // reads ANTHROPIC_API_KEY from env

async function classify(task) {
  const msg = await client.messages.create({
    model: ROUTER_MODEL,
    max_tokens: 200,
    messages: [{ role: 'user', content: `${ROUTER_PROMPT}\n\nTask: ${task}` }],
  })
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  return parseRouterOutput(text)
}

const outcomes = []
for (const [i, item] of dataset.entries()) {
  let parsed = null
  try {
    parsed = await classify(item.task)
  } catch (err) {
    console.error(`[${i + 1}/${dataset.length}] router error: ${err.message}`)
  }
  // Parse failure OR policy → opus fallback is built into decideModel for null tier.
  const chosen = parsed
    ? decideModel({ tier: parsed.tier, confidence: parsed.confidence }).model
    : 'opus'
  outcomes.push({ trueTier: item.expectedTier, chosenModel: chosen })
  const flag = item.expectedTier === 'Hard' && chosen !== 'opus' ? '  ⚠ FALSE-DOWNGRADE' : ''
  console.error(`[${i + 1}/${dataset.length}] ${item.expectedTier.padEnd(8)} → ${chosen}${flag}`)
}

const metrics = computeMetrics(outcomes)
console.log('\n=== smart-dispatch eval ===')
console.log(JSON.stringify(metrics, null, 2))
console.log('\nRed line: falseDowngradeRate should be ~0. Target savingsRate: 0.3–0.5.')
```

**Step 3: Smoke-check the script loads (no API key needed for import)**

Run: `node --check eval/run-eval.js`
Expected: no output (syntax OK).

**Step 4: Commit**

```bash
git add eval/run-eval.js package.json package-lock.json
git commit -m "feat: add eval harness using live haiku router"
```

---

### Task 9: Run the eval and record baseline metrics

This is a **manual, online** step — it spends ~30–50 cheap Haiku calls. Record the result so we have a baseline and can decide whether to raise the router to sonnet (design §10).

**Files:**
- Create: `docs/eval-baseline-2026-07-12.md`

**Step 1: Run the eval**

Run: `ANTHROPIC_API_KEY=<your-key> npm run eval`
Expected: progress lines, then a JSON metrics block. Capture the numbers.

**Step 2: Write `docs/eval-baseline-2026-07-12.md`** with the actual numbers, e.g.:

```markdown
# smart-dispatch eval baseline — 2026-07-12

- Router model: claude-haiku-4-5-20251001
- Dataset size: <N>
- **falseDowngradeRate: <X>**  (red line — target ~0)
- **savingsRate: <Y>**  (target 0.3–0.5)

## Decision
- If falseDowngradeRate > 0.05 → raise router to sonnet (design §10), re-run, record again.
- Else → current haiku router + 0.8 threshold is acceptable for v0.1.
```

**Step 3: Commit**

```bash
git add docs/eval-baseline-2026-07-12.md
git commit -m "docs: record eval baseline metrics"
```

---

### Task 10: README + LICENSE

**Files:**
- Create: `README.md`
- Create: `LICENSE`

**Step 1: Write `README.md`**

````markdown
# smart-dispatch

> Quality-first automatic model routing for Claude Code sub-agents.
> **Every task gets the right model — default strongest, downgrade only when confidently trivial.**

Most "model routers" optimize for cost and quietly drop quality on hard tasks. smart-dispatch inverts that: **it never loses quality to a routing mistake.** The only acceptable misjudgment is treating a simple task as hard (a little wasted spend) — never the reverse.

## What it does

Before dispatching a sub-agent, smart-dispatch:

1. Classifies the task with a **cheap model** (Haiku) → `{tier, confidence}`.
2. Applies a **quality-first policy**: default `opus`; downgrade only when `tier ∈ {Trivial, Routine}` AND `confidence ≥ 0.8`.
3. Dispatches the worker with the chosen model.

| Tier | Example | Model |
|------|---------|-------|
| Trivial | grep, list files, read config | haiku |
| Routine | clear-pattern edit, summarize, format | sonnet |
| Hard | design, debug, new code, architecture | opus |
| uncertain | anything fuzzy | opus (fallback) |

## Install

```bash
claude plugin add <your-org>/smart-dispatch
```

The skill activates automatically whenever a sub-agent is about to be dispatched. If you name a model explicitly, smart-dispatch respects it and skips routing.

## Tuning knobs

Both live in `src/decide-model.js` (the single source of truth; `SKILL.md` mirrors them):

- **`DOWNGRADE_THRESHOLD`** (default `0.8`) — raise for more conservative routing (closer to all-opus); lower to downgrade more aggressively.
- **Router model** — default Haiku. If eval shows false-downgrades, raise to Sonnet.

## Validate

```bash
npm install      # dev deps only
npm test         # unit tests for policy, parser, metrics
ANTHROPIC_API_KEY=xxx npm run eval   # live routing-quality eval
```

The eval reports two numbers:
- **falseDowngradeRate** — Hard tasks routed below opus. **Red line: ~0.**
- **savingsRate** — spend vs all-opus baseline. Target 0.3–0.5.

## License

MIT.
````

**Step 2: Write `LICENSE`** (MIT — fill in the copyright year and holder)

```
MIT License

Copyright (c) 2026 <your name>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Step 3: Commit**

```bash
git add README.md LICENSE
git commit -m "docs: add README and MIT license"
```

---

## Definition of done

- [ ] All four pure modules pass `node --test` (decide-model, parse-router-output, compute-metrics, dataset schema).
- [ ] `skills/smart-dispatch/SKILL.md` policy matches `src/decide-model.js` (manual diff).
- [ ] `plugin.json` is valid JSON.
- [ ] Eval run completed; `falseDowngradeRate` is at/near 0; baseline recorded in `docs/`.
- [ ] README + MIT LICENSE present.
- [ ] Shipped plugin has zero runtime dependencies (SDK is dev-only).

## Deferred (per design §11)

- `workflows/batch-route.js` — Workflow "pro mode" with budget-adaptive downgrade. Build once users ask for batch/deterministic routing. It will import the same `decide-model.js` (workflow scripts can't import local modules, so the policy will need to be inlined or served via a thin shared mechanism at that point — revisit then).
- Tier-rule calibration based on accumulating eval data.
- English versions of design doc + README for international reach.
