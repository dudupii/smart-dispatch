---
description: Show smart-dispatch routing stats — model distribution, estimated savings, and budget-mode downgrades.
---

Show the user their smart-dispatch routing stats.

Read the routing log at `$SMART_DISPATCH_LOG` (default `~/.smart-dispatch/log.jsonl`) and summarize it: total decisions, model distribution (haiku / sonnet / opus counts), estimated savings vs an all-opus baseline, and the fraction of Hard-tier tasks downgraded (budget mode).

The bundled report script `scripts/report.mjs` computes this — run it if you can locate this plugin's directory (try `~/.claude/plugins/`), otherwise read the log file directly and compute the same summary with the Bash and Read tools. If the log doesn't exist yet, tell the user it appears once the skill routes its first sub-agent dispatch.
