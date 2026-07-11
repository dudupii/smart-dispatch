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
- **Everything else → opus**, including any uncertainty, low/non-finite confidence, or parse failure.
- **User override wins**: if the user named a model, use it verbatim and skip routing.
- **Budget mode** (Workflow pro mode only): if remaining budget < 0.1, opus may step down to sonnet. This is the only allowed downward override of opus; it never escalates an already-downgraded task.

The router returns a `model` field of its own — **ignore it**. The policy re-derives the choice from `tier` + `confidence` alone.

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
3. **Decide.** Apply the policy to the parsed `tier` + `confidence` (ignore the router's `model`). If the output can't be parsed → opus.
4. **Execute.** Dispatch the real worker agent with the chosen model.

## Fallback

Any error, ambiguity, or low confidence → **opus**. Never lose quality to a routing mistake. The only acceptable misjudgment direction is treating a simple task as hard (a little wasted spend) — never the reverse.
