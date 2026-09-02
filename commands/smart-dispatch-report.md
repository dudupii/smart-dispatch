---
description: Show smart-dispatch routing stats — model distribution, estimated savings, budget-mode downgrades, and self-healed retries.
---

Show the user their smart-dispatch routing stats.

Read the routing log at `$SMART_DISPATCH_LOG` (default `~/.smart-dispatch/log.jsonl`) and summarize it: total decisions, model distribution (haiku / sonnet / opus counts), tier and agent breakdowns, estimated savings vs an all-opus baseline (labeled with the versioned price table), the fraction of Hard-tier tasks downgraded (budget mode), and the number of self-healed retries (entries with `escalatedFrom`).

If the user asks for a time window, filter to entries with `ts` at/after the window start (today = local midnight; `7d`/`24h` = span ago).

The bundled report script `scripts/report.mjs` computes this (`node scripts/report.mjs [--today | --since 7d] [--json]`) — run it if you can locate this plugin's directory (try `~/.claude/plugins/`), otherwise read the log file directly and compute the same summary with the Bash and Read tools. If the log doesn't exist yet, tell the user it appears once smart-dispatch routes its first sub-agent dispatch.
