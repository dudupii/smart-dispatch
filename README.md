# smart-dispatch

> Quality-first automatic model routing for Claude Code sub-agents.
> **Every task gets the right model — default strongest, downgrade only when confidently trivial.**

[English](README.md) · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md)

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
claude plugin marketplace add dudupii/smart-dispatch
claude plugin install smart-dispatch@smart-dispatch
```

The skill activates automatically whenever a sub-agent is about to be dispatched (~70 tokens always-on; ~520 per invoke). If you name a model explicitly, smart-dispatch respects it and skips routing.

## Tuning knobs

These live in `src/decide-model.js` (the single source of truth; `skills/smart-dispatch/SKILL.md` mirrors them in prose):

- **`DOWNGRADE_THRESHOLD`** (default `0.8`) — the confidence required to leave opus. Raise for more conservative routing (closer to all-opus); lower to downgrade more aggressively.
- **`BUDGET_FLOOR`** (default `0.1`) — only relevant to budget mode (the Workflow pro mode, `workflows/batch-route.js`): when remaining budget drops below this fraction, opus steps down to sonnet. Never escalates an already-downgraded task.
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

## Pro mode: batch routing (budget-adaptive)

`workflows/batch-route.js` is a [Workflow](https://docs.claude.com/claude-code/workflows) for batch processing with cost control. It applies the same quality-first policy **plus** budget awareness: when remaining budget drops below `BUDGET_FLOOR`, `opus` tasks step down to `sonnet` (the only allowed downward override of opus). Hand it a task or an array of tasks as `args`; it routes each with Haiku, then executes each on the chosen model.

> **Caveat:** workflow scripts run in a sandbox and cannot `import` local modules, so the policy is **inlined** in the script. `src/decide-model.js` remains the source of truth — keep them in sync. Running it spawns one sub-agent per task (multi-agent orchestration), so it spends tokens.

## Observability

Every routing decision is shown inline (`smart-dispatch → haiku (Trivial, conf 0.92)`) and appended to a local log at `~/.smart-dispatch/log.jsonl` — **only `tier`, `confidence`, `model`, and a timestamp** are recorded, never the task text.

See aggregate stats anytime:

```bash
npm run report        # or the /smart-dispatch command in a session
```

It reports total decisions, model distribution, estimated savings vs all-opus, and how often budget mode downgraded opus. Override the log path with `SMART_DISPATCH_LOG`.

## License

MIT.
