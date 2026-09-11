# smart-dispatch for Codex CLI

Quality-first routing for Codex sub-agent spawns, via Codex's `PreToolUse`
hook (block + `updatedInput` rewriting). Two modes, chosen per spawn:

- **Veto mode** (works under default multi-agent V2, where spawn model
  metadata is hidden): a confidently trivial/routine spawn is **denied** with
  a reason naming a pre-pinned slot agent to re-dispatch to. Costs one extra
  round-trip on downgraded spawns only; hard/uncertain tasks always pass.
- **Rewrite mode** (older schema, or V2 with `hide_spawn_agent_metadata = false`
  in `~/.codex/config.toml`): a downgrade on a spawn that did **not** name a
  model (it would inherit the session default) writes the slot's model id in
  place, exactly like the Claude Code hook. Requires slot→model ids in your
  smart-dispatch config (see below). A spawn that names a model is an
  explicit choice and is never touched.

## Install

1. **Hook** — merge into `~/.codex/hooks.json` (or your project's
   `.codex/hooks.json`), pointing `command` at this file's absolute path in
   your clone of the repo:

   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Agent",
           "hooks": [
             { "type": "command", "command": "node /path/to/smart-dispatch/codex/hooks/route-codex.mjs", "timeout": 10 }
           ]
         }
       ]
     }
   }
   ```

   Codex asks you to review non-managed hooks before they run — approve it.

2. **Slot agents** (veto mode) — copy or symlink `codex/agents/*.toml` into
   `~/.codex/agents/`, then edit each file's `model` to what your plan offers
   (keep the explorer lane materially cheaper than your default model).

3. **Rewrite mode (optional)** — in `~/.smart-dispatch/config.json`:

   ```json
   {
     "codex": {
       "models": { "light": "<cheap model id>", "mid": "<mid model id>" },
       "agents": { "light": "smart-dispatch-explorer", "mid": "smart-dispatch-worker" }
     }
   }
   ```

   Slot keys are canonical (`light`/`mid`/`heavy`); the pre-v0.5.0 names
   (`haiku`/`sonnet`/`opus`) still work as synonyms. `agents` overrides the
   deny reason's target if you rename the TOMLs.

## Behaviour shared with the other hosts

Explicit models always win (a spawn that names a model — or targets a custom
agent you pinned yourself — is never rewritten or denied). Decisions append
to the shared log (`~/.smart-dispatch/log.jsonl`, `host: "codex"`), and a
re-dispatched task self-heals: retrying a spawn that was recently routed
down is allowed through untouched. `SMART_DISPATCH_DRY=1` logs decisions
without acting.

> **Verified against the documented hook contract; not yet live-spiked.**
> The payload shapes this adapter handles cover both documented schemas. If
> Codex changes them, the failure mode is a logged no-op — the hook never
> blocks a spawn on its own errors.

## Live spike (2 minutes, when you have network to OpenAI)

Confirms which spawn schema your Codex build actually emits (veto vs rewrite
mode) and that the hook fires:

1. In a scratch dir, create `.codex/hooks.json` with a `PreToolUse` /
   `"matcher": "Agent"` hook whose command is `node` on a tiny script that
   appends stdin to a file and prints `{}`.
2. From that dir: `codex exec --skip-git-repo-check --sandbox read-only "Use
   a subagent (spawn_agent) to search this directory for json files and
   report the filenames briefly."`
3. Inspect the captured payload: if `tool_input` carries a `model` field,
   rewrite mode is available (configure `codex.models`); if it only has
   `task_name`/`message`/`fork_turns`, you are on metadata-hidden V2 — veto
   mode with the slot agents is the path.
4. Then install this adapter per the instructions above and re-run: the
   shared log (`~/.smart-dispatch/log.jsonl`) should gain a `host: "codex"`
   entry, and trivial spawns should get denied with the slot-agent reason.
