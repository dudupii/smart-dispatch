# smart-dispatch — Quality-First Automatic Model Router

- **Date:** 2026-07-12
- **Status:** Design approved (design phase; implementation plan follows)
- **Type:** Open-source Claude Code plugin
- **中文版 (Chinese):** [`2026-07-12-smart-dispatch-design.zh.md`](./2026-07-12-smart-dispatch-design.zh.md)

---

## 1. One-line positioning

> **Every sub-agent task gets the right model — strongest by default, downgrade only when confidently trivial.**

An open-source Claude Code plugin that automatically selects the model before dispatching a sub-agent. Unlike the "cost-saving routers" on the market, this tool's promise is: **it never loses quality to a routing mistake.**

Marketing pitch: *"Max quality, save money along the way."*

## 2. Background

In Claude Code, **the model is fixed at the moment an agent is spawned — it cannot be switched mid-run.** So "automatic model selection" really comes down to two questions: where does the decision logic live, and what triggers it.

Manually picking a model per task is tedious and error-prone (trivial tasks wasted on opus; hard tasks degraded on haiku). This tool uses a cheap "router" agent to classify the task once before dispatch, then automatically decides which model the execution agent should use.

## 3. Key design decisions

Three core choices made during brainstorming:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Pattern** | Router pattern (cheap model classifies → strong model executes) | Turns "pick a model" from fuzzy judgment into reliable structured data |
| **Vehicle** | Skill (OSS primary vehicle) + optional Workflow | OSS distribution: a Skill is zero-dependency, transparent, editable, and works the moment it's installed; transparency = trust |
| **Positioning** | Quality-first (default opus, downgrade only when confidently trivial) | Inverts the cost-saving logic: the only acceptable misjudgment is treating a simple task as hard (a little wasted spend) — never the reverse |

## 4. Architecture & data flow

```
Task arrives
   │
   ▼
┌──────────────────────────────────┐
│ Router (haiku, runs per dispatch) │
│ Input: task prompt                │
│ Output: { tier, model,            │
│          confidence, reason }     │
└──────────────────────────────────┘
   │
   ├──► confidence ≥ 0.8 AND tier ∈ {Trivial, Routine}
   │    → execute downgraded (haiku / sonnet)
   │
   └──► otherwise / unsure / router error
        → execute on opus (fallback)
```

**Core principle: when in doubt, go up.** The only acceptable misjudgment is treating a simple task as hard (a little wasted spend) — never treating a hard task as simple (lost quality).

## 5. Routing taxonomy

| Tier | Signal | Model |
|------|--------|-------|
| **Trivial** | pure search / grep / read config / list files / string lookup | haiku |
| **Routine** | clear-pattern edit / summarize known content / format / apply a template | sonnet |
| **Hard** | reasoning / design / debug / multi-file logic / new code / architecture | opus |
| **Uncertain** | anything fuzzy, insufficient info, router unsure | opus (fallback) |

**Downgrade threshold:** downgrade only when `confidence ≥ 0.8` **and** tier is Trivial or Routine; otherwise always opus.

## 6. SKILL.md design

The shipped skill (`skills/smart-dispatch/SKILL.md`) instructs the agent to pick a model before dispatching a sub-agent. Its shape:

```markdown
---
name: smart-dispatch
description: Quality-first automatic model routing. Before dispatching a sub-agent,
  classify the task with a cheap model and pick opus by default — downgrade only
  when confidently trivial/routine. Trigger when about to call the Agent/Task tool.
---

## Policy (source of truth: src/decide-model.js)
- Default: opus. Quality first.
- Downgrade ONLY when tier ∈ {Trivial, Routine} AND confidence ≥ 0.8.
- Everything else → opus (including any uncertainty or parse failure).
- User override wins.
- Budget mode (Workflow pro mode only): remaining budget < 0.1 → opus may step to sonnet.

## Steps
1. If the user named a model → use it. Stop.
2. Route with a haiku classifier → {tier, model, confidence, reason}.
3. Apply the policy to tier + confidence (ignore the router's suggested model).
   Parse failure → opus.
4. Dispatch the worker with the chosen model.

## Fallback
Any error, ambiguity, or low confidence → opus. Never lose quality to a routing mistake.
```

The prose policy is a mirror of the tested function `src/decide-model.js`, which is the single source of truth.

## 7. Edge cases

| Case | Handling |
|------|----------|
| Task itself is fuzzy (e.g. "fix that bug" with no detail) | opus (needs reasoning just to figure out what to do) |
| Router itself errors | opus |
| **User explicitly named a model** | Respect the user, skip routing |
| Workflow pro mode + budget exhausted | the only allowed downward override of opus |

## 8. Packaging structure

```
smart-dispatch-plugin/
├── plugin.json
├── skills/
│   └── smart-dispatch/
│       └── SKILL.md          ← core; works on install
├── workflows/
│   └── batch-route.js        ← optional pro mode (budget-adaptive)
└── docs/plans/
    └── 2026-07-12-smart-dispatch-design.md
```

Install: `claude plugin add <repo>`

## 9. Validation method

Build a labeled set (~50 tasks), each tagged with its expected tier. Run the router and watch two metrics:

- **falseDowngradeRate** (Hard tasks misjudged as Trivial/Routine and routed below opus) → **approach 0; this is the quality red line.**
- **savingsRate** (actual spend vs an all-opus baseline) → expected 0.3–0.5.

Result (see `docs/eval-baseline-2026-07-12.md`): `falseDowngradeRate: 0`, `savingsRate: 0.49` over 50 tasks.

## 10. Tunable parameters (calibrate at implementation)

- **Router model:** default haiku (runs on every dispatch, must be cheap). If §9 validation shows a high false-downgrade rate, bump the router to sonnet. (Not triggered: false-downgrade rate was 0.)
- **Downgrade threshold:** default `confidence ≥ 0.8`. Higher = more conservative (closer to all-opus); lower = more aggressive.

## 11. Future work

- **Workflow pro mode (`batch-route.js`):** deterministic routing + budget-adaptive downgrade for power users. When the remaining budget drops below a floor, opus may step down to sonnet — the only allowed "downward misjudgment" trigger.
- **Routing-taxonomy calibration:** continuously refine the tier rules from accumulated eval data.
- **i18n:** this English design doc and the README are now available; the original Chinese design is retained as `.zh.md`.
