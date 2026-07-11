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

The router's own `model` suggestion is **ignored** — the policy re-derives the choice from `tier` + `confidence` alone.

## Install

```bash
claude plugin add <your-org>/smart-dispatch
```

The skill activates automatically whenever a sub-agent is about to be dispatched. If you name a model explicitly, smart-dispatch respects it and skips routing.

## Tuning knobs

Both live in `src/decide-model.js` (the single source of truth; `skills/smart-dispatch/SKILL.md` mirrors them in prose):

- **`DOWNGRADE_THRESHOLD`** (default `0.8`) — the confidence required to leave opus. Raise for more conservative routing (closer to all-opus); lower to downgrade more aggressively.
- **Router model** — default Haiku (configured in `eval/run-eval.js`). If eval shows false-downgrades, raise to Sonnet.

## Validate

```bash
npm install                       # dev deps only (@anthropic-ai/sdk)
npm test                          # unit tests: policy, parser, metrics, dataset schema
ANTHROPIC_API_KEY=xxx npm run eval   # live routing-quality eval over eval/dataset.json
```

The eval reports two numbers:

- **falseDowngradeRate** — Hard tasks routed below opus. **Red line: ~0.**
- **savingsRate** — spend vs an all-opus baseline. Target 0.3–0.5.

## How it's built

- `src/decide-model.js` — the quality-first policy (single source of truth, fully unit-tested).
- `src/parse-router-output.js` — defensive parser for the router agent's output.
- `src/compute-metrics.js` — false-downgrade + savings metrics.
- `skills/smart-dispatch/SKILL.md` — the shipped skill; mirrors the policy in prose.
- `eval/` — labeled dataset + harness that validates routing quality end-to-end.

The shipped plugin has **zero runtime dependencies** — the Anthropic SDK is dev-only, used solely by the eval harness.

## License

MIT.
