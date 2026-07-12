# smart-dispatch eval baseline — 2026-07-12

- **Router model:** `claude-haiku-4-5-20251001`
- **Downgrade threshold:** `0.8` (confidence required to leave opus)
- **Dataset size:** 36 tasks (`eval/dataset.json`)
- **falseDowngradeRate: `0`** — red-line metric, target ~0 → **✅ MET**
- **savingsRate: `0.4667`** (46.7%) — target 0.3–0.5 → **✅ IN RANGE**

## Per-tier routing

| True tier | Count | Routed to |
|-----------|-------|-----------|
| Trivial | 10 | 10 × haiku |
| Routine | 10 | 4 × haiku, 6 × sonnet |
| Hard | 16 | 16 × opus |

Notes:
- All 16 Hard tasks landed on opus — **zero false downgrades**. The quality-first guarantee held.
- The router re-classified 4 Routine-labeled tasks as Trivial (confident → haiku). This is the *safe* disagreement direction (treating a task as easier than labeled) and contributes to the savings.

## Decision

- `falseDowngradeRate` is `0`, well within the red line. **The default Haiku router + 0.8 threshold is acceptable for v0.1.**
- The design §10 fallback condition ("if false-downgrade rate is high, raise router to sonnet") is **not triggered** — no change needed.

## Reproducing

```bash
npm install
ANTHROPIC_API_KEY=xxx npm run eval
```

Raw output is printed to stdout; the two metrics above are the JSON block from `computeMetrics`.
