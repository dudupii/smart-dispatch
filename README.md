# smart-dispatch

> Quality-first automatic model routing for Claude Code sub-agents.
> **Every task gets the right model — default strongest, downgrade only when confidently trivial.**

[![tests](https://img.shields.io/github/actions/workflow/status/dudupii/smart-dispatch/test.yml?branch=master&label=tests)](https://github.com/dudupii/smart-dispatch/actions/workflows/test.yml)
[![version](https://img.shields.io/github/v/release/dudupii/smart-dispatch?color=blue)](https://github.com/dudupii/smart-dispatch/releases)
[![license](https://img.shields.io/github/license/dudupii/smart-dispatch?color=green)](./LICENSE)
[![stars](https://img.shields.io/github/stars/dudupii/smart-dispatch?style=social)](https://github.com/dudupii/smart-dispatch/stargazers)

[English](README.md) · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md)

<p align="center"><img src="docs/demo.gif" alt="smart-dispatch routing demo" width="640"></p>

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

Once installed, routing is **automatic and transparent**: a `PreToolUse` hook intercepts every `Agent` tool call and rewrites the model in place via `updatedInput` — you never have to remember a command, and the model cannot bypass it by calling the Agent tool directly. If you name a model explicitly, smart-dispatch respects it and skips routing.

> The hook uses conservative heuristics (read-only `Explore` tasks, plus a narrow gate for short read-only/mechanical `general-purpose` prompts). If a downgrade turns out to be wrong, the next dispatch of the same task is **self-healed** back to the session default — see [retry-escalation](#observability). For higher-fidelity routing with a Haiku classifier, invoke `/smart-dispatch` explicitly — both paths share the same `src/decide-model.js` policy and write to the same log. Set `SMART_DISPATCH_DRY=1` to preview routing decisions in the log without ever rewriting a call.

## Tuning knobs

Tuning is **data, not source edits**. Defaults live in `src/decide-model.js` (the single source of truth) and can be overridden by `~/.smart-dispatch/config.json` (path via `SMART_DISPATCH_CONFIG`) or env vars:

```json
{
  "downgradeThreshold": 0.8,
  "budgetFloor": 0.1,
  "escalation": { "enabled": true, "windowMinutes": 10 },
  "agentOverrides": { "my-file-finder": "haiku", "my-careful-agent": "never" },
  "priceTable": { "haiku": 0.1, "sonnet": 0.3, "opus": 1.0 }
}
```

- **`downgradeThreshold`** (default `0.8`, env `SMART_DISPATCH_THRESHOLD`) — the confidence required to leave opus. Raise for more conservative routing (closer to all-opus); lower to downgrade more aggressively.
- **`budgetFloor`** (default `0.1`, env `SMART_DISPATCH_BUDGET_FLOOR`) — only relevant to budget mode (the Workflow pro mode, `workflows/batch-route.js`): when remaining budget drops below this fraction, opus steps down to sonnet. Never escalates an already-downgraded task.
- **`escalation`** (env kill switch `SMART_DISPATCH_ESCALATION=0`) — self-healing window for re-dispatched tasks that were downgraded.
- **`agentOverrides`** — a fixed model per subagent type (applied verbatim, like a user override), or `"never"` to leave that type untouched.
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
- `src/classify-heuristic.js` — conservative heuristic classifier used by the hook (read-only `Explore`; narrow general-purpose gate), gated by adversarial tests.
- `hooks/route.mjs` + `hooks/hooks.json` — the `PreToolUse` hook that makes routing automatic.
- `src/config.js` — user config (file + env), never throws, invalid values fall back.
- `src/escalation.js` — retry-escalation: self-heals a wrong downgrade on the next dispatch.
- `src/parse-router-output.js` — defensive parser for the router agent's output.
- `src/compute-metrics.js` — false-downgrade + savings metrics, with a versioned price table.
- `skills/smart-dispatch/SKILL.md` — the shipped skill; mirrors the policy in prose.
- `eval/` — labeled dataset + harness that validates routing quality end-to-end.

The shipped plugin has **zero runtime dependencies** — the Anthropic SDK is dev-only, used solely by the eval harness.

## Pro mode: batch routing (budget-adaptive)

`workflows/batch-route.js` is a [Workflow](https://docs.claude.com/claude-code/workflows) for batch processing with cost control. It applies the same quality-first policy **plus** budget awareness: when remaining budget drops below `BUDGET_FLOOR`, `opus` tasks step down to `sonnet` (the only allowed downward override of opus). Hand it a task or an array of tasks as `args`; it routes each with Haiku, then executes each on the chosen model.

> **Caveat:** workflow scripts run in a sandbox and cannot `import` local modules, so the policy is **inlined** in the script — a sync-guard test (`test/policy-sync.test.js`) fails CI if the copy ever drifts from `src/decide-model.js`. Running it spawns one sub-agent per task (multi-agent orchestration), so it spends tokens.

## Observability

Every routing decision is shown inline (`smart-dispatch → haiku (Trivial, conf 0.92)`) and appended to a local log at `~/.smart-dispatch/log.jsonl` — **only `tier`, `confidence`, `model`, a timestamp, the subagent type, and a one-way `hash` of the task** are recorded, never the task text. A `Retry` entry records each self-healed downgrade (`escalatedFrom`): when the same task is re-dispatched within the escalation window after being routed below opus, the hook withholds the downgrade and logs the correction — a wrong downgrade costs one cheap attempt, not a broken task.

See aggregate stats anytime:

```bash
npm run report                    # or the /smart-dispatch-report command in a session
npm run report -- --today         # today only
npm run report -- --since 7d      # last 7 days (or 24h, or 2026-08-01)
npm run report -- --json          # machine-readable
```

It reports total decisions, model/tier/agent distribution, estimated savings vs all-opus (labeled with the versioned price table — the estimate is honest about which prices it used), budget-mode downgrades, and self-healed retries. Override the log path with `SMART_DISPATCH_LOG`.

## License

MIT.
