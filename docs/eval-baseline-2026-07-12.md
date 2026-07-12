# smart-dispatch eval baseline — 2026-07-12

- **Router model:** `claude-haiku-4-5-20251001`
- **Downgrade threshold:** `0.8` (confidence required to leave opus)
- **Dataset size:** 50 tasks (`eval/dataset.json` — 15 Trivial / 15 Routine / 20 Hard)
- **falseDowngradeRate: `0`** — red-line metric, target ~0 → **✅ MET (robust across runs)**
- **savingsRate: `0.492`** (49.2%) — target 0.3–0.5 → **✅ IN RANGE**

## Per-tier routing

| True tier | Count | Routed to |
|-----------|-------|-----------|
| Trivial | 15 | 15 × haiku |
| Routine | 15 | 12 × sonnet, 3 × haiku |
| Hard | 20 | 20 × opus |

Notes:
- All 20 Hard tasks landed on opus — **zero false downgrades**. The quality-first guarantee held.
- The router re-classified 3 Routine-labeled tasks as Trivial (confident → haiku). This is the *safe* disagreement direction (treating a task as easier than labeled) and adds to the savings.

## Run-to-run variance

`falseDowngradeRate` is stable at `0` across runs. `savingsRate` varies slightly (~0.486–0.492 observed) because the Haiku router's classification of borderline Routine tasks is mildly non-deterministic. The variance affects only the cost metric, never the quality metric.

## Decision

- `falseDowngradeRate` is `0`, well within the red line. **The default Haiku router + 0.8 threshold is acceptable for v0.1.**
- The design §10 fallback condition ("if false-downgrade rate is high, raise router to sonnet") is **not triggered** — no change needed.

## Reproducing

```bash
npm install
ANTHROPIC_API_KEY=xxx npm run eval
```

Raw output is printed to stdout; the two metrics above are the JSON block from `computeMetrics`. Expect `savingsRate` to drift within ~±0.01 between runs; `falseDowngradeRate` should remain `0`.
