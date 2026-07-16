# Privacy Policy — smart-dispatch

**Last updated: 2026-07-16**

smart-dispatch is a Claude Code plugin that selects a model before dispatching a sub-agent. It is built to collect no personal data and to contact no external service of its own.

## Summary

- **No personal data is collected.**
- **No telemetry, analytics, or crash reporting.**
- **No external network calls** are made by the plugin. The only model calls (the Haiku classification and the dispatched worker) are the ones Claude Code already makes as part of its normal operation — not a plugin-specific endpoint.

## Local log

When the skill routes a task, it appends a single line to a **local file on your machine**:

- Path: `~/.smart-dispatch/log.jsonl` (override with the `SMART_DISPATCH_LOG` environment variable)
- Contents: **only** `{ timestamp, tier, confidence, model }` — the routing decision metadata.
- It does **not** record task text, prompts, code, file contents, or anything identifying.

This file never leaves your machine. You can read it, delete it (`rm ~/.smart-dispatch/log.jsonl`), or disable logging entirely by setting `SMART_DISPATCH_LOG=/dev/null`.

## Third parties

None. The plugin transmits no data to any third party. Model calls go to your configured Claude/Anthropic backend as part of normal Claude Code usage, not to any smart-dispatch-operated service.

## Open source

Everything is auditable: https://github.com/dudupii/smart-dispatch

## Contact

Open an issue: https://github.com/dudupii/smart-dispatch/issues
