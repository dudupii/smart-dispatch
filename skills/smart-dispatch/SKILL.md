---
name: smart-dispatch
description: Quality-first automatic model routing. Before dispatching a sub-agent, classify the task with a cheap model and default to the heavy tier — downgrade only when confidently trivial/routine. Trigger when about to dispatch a task to a sub-agent.
---

# smart-dispatch

You are about to dispatch a sub-agent. Pick the right model first — do not just default to something.

## Model vocabulary

Model names are host-neutral **slots**: `light` / `mid` / `heavy` (cheap → strong). Each host resolves them to its own models — see Host notes. Legacy names (`haiku`/`sonnet`/`opus`) are accepted synonyms in config and old logs; canonical is `light`/`mid`/`heavy`.

## Policy (defaults; in a clone of the repo, `src/decide-model.js` is the executable source of truth — keep in sync)

- **Default: heavy.** Quality first.
- **Downgrade ONLY when** `tier ∈ {Trivial, Routine}` AND `confidence ≥ 0.8`:
  - Trivial → `light`
  - Routine → `mid`
- **Everything else → heavy**, including any uncertainty, low/non-finite confidence, or parse failure.
- **User override wins**: if the user named a model (or pinned an agent with a fixed model), use it verbatim and skip routing.
- **Budget mode** (Workflow pro mode only): if remaining budget < 0.1, heavy may step down to mid. This is the only allowed downward override of heavy; it never escalates an already-downgraded task.
- The numbers above are defaults — the user's config (`~/.smart-dispatch/config.json`, or `SMART_DISPATCH_THRESHOLD` env) may override the threshold. Honor a configured value if you can read one; otherwise use these defaults.

The router returns a `model` field of its own — **ignore it**. The policy re-derives the choice from `tier` + `confidence` alone.

## Steps

1. **Override check.** If the user explicitly named a model (or dispatched to a pinned agent) → use it. Stop here.
2. **Retry check (self-healing).** Tail the shared routing log (`tail` the file at `$SMART_DISPATCH_LOG` or `~/.smart-dispatch/log.jsonl`) and look for an entry from the last ~10 minutes whose `hash` matches this task's (step 5 defines the hash). If such an entry routed below heavy, this re-dispatch says the downgrade didn't stick → choose **heavy** this time. Log it as tier `Retry` with `escalatedFrom: "<previous model>"` and stop.
3. **Route.** Dispatch a classifier agent on the **light** slot's model for the host, asking for structured output only:
   ```json
   {"tier":"Trivial"|"Routine"|"Hard","model":"light"|"mid"|"heavy","confidence":0..1,"reason":"..."}
   ```
   Classification guide:
   - **Trivial** → pure search / grep / read config / list files / string lookup
   - **Routine** → clear-pattern edit / summarize known content / format / apply a template
   - **Hard** → reasoning / design / debug / multi-file logic / new code / architecture
   - When unsure, pick **Hard** and lower the confidence.
4. **Decide.** Apply the policy to the parsed `tier` + `confidence` (ignore the router's `model`). If the output can't be parsed → heavy.
5. **Show + log the decision (transparency).** Print one line so the user can see the routing:
   ```
   smart-dispatch → <slot> (<tier>, conf <confidence>)
   ```
   Then append a record to the shared routing log (best-effort — **routing metadata only, never the task text**; `hash` is a one-way digest of the task used for retry matching; `host` tags which agent dispatched it, one of `claude-code` / `pi` / `codex`; `model` is the canonical slot):
   ```bash
   mkdir -p "${SMART_DISPATCH_LOG_DIR:-$HOME/.smart-dispatch}" && printf '{"ts":"%s","tier":"%s","confidence":%s,"model":"%s","hash":"%s","agent":"%s","host":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "<tier>" "<confidence>" "<slot>" "$(printf '%s' "<description> <prompt>" | tr -s '[:space:]' ' ' | sha256sum | cut -c1-10)" "<subagent_type>" "<host>" >> "${SMART_DISPATCH_LOG:-$HOME/.smart-dispatch/log.jsonl}"
   ```
   Users review aggregate stats with the report command (see Host notes) or `npm run report`.
6. **Execute.** Dispatch the real worker agent on the chosen slot's model for the host.

## Fallback

Any error, ambiguity, or low confidence → **heavy**. Never lose quality to a routing mistake. The only acceptable misjudgment direction is treating a simple task as hard (a little wasted spend) — never the reverse.

## Host notes

The policy above is host-neutral. Host-specific dispatch mechanics, slot→model resolution, and commands:

- **Claude Code** — dispatch happens via the `Agent` tool; slots resolve to wire names `light→haiku`, `mid→sonnet`, `heavy→opus`. A `PreToolUse` hook performs this routing automatically for every dispatch; this skill is the explicit, higher-fidelity path. Report: `/smart-dispatch:smart-dispatch-report` (or `npm run report`).
- **Pi** — the bundled extension (`extensions/smart-dispatch/`) routes automatically per prompt: the session's model is the ceiling, confidently trivial/routine prompts step down within your provider, `/model` pins routing off. This skill is the explicit path when installed via the `pi` packaging field. Report: `npm run report` from a clone of this repo.
- **Codex** — dispatch happens via `spawn_agent`; a `PreToolUse` adapter (`codex/hooks/`) routes automatically (rewrite or veto mode, per your config). A spawn to a user-pinned custom agent counts as an override: skip routing entirely. Report: `npm run report` from a clone of this repo.
