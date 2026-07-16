# Contributing to smart-dispatch

Thanks for considering a contribution! smart-dispatch is a small, deliberately focused plugin — this guide keeps it that way.

## The one rule that matters most

**`src/decide-model.js` is the single source of truth for the routing policy.** `skills/smart-dispatch/SKILL.md` mirrors it in prose, and `workflows/batch-route.js` inlines it (workflow scripts can't import local modules). If you change the policy, update **all three** in the same PR — the CI integrity test (`test/plugin.test.js`) will fail if `SKILL.md` or the README drifts from the code's constants.

## Development setup

```bash
git clone https://github.com/dudupii/smart-dispatch
cd smart-dispatch
npm install      # dev deps only (@anthropic-ai/sdk)
npm test         # 41 tests, should be green
```

Requires Node ≥ 18 (CI runs 22 and 24).

## How to work

- **TDD.** Pure logic lives in `src/` and is fully unit-tested. Write/adjust the test first, watch it fail, then implement. The quality-first guarantee ("never downgrade a Hard task below opus") must stay backed by tests.
- **YAGNI.** Don't add a feature unless it has a clear user. The Workflow pro mode and i18n were both deferred until asked — that's the house style.
- **Don't break the guarantee.** The only acceptable misjudgment direction is treating a simple task as hard. A PR that can route a Hard task below opus (other than documented budget mode) will not merge.

## Validating your change

```bash
npm test                                       # unit + integrity tests
claude plugin validate .                       # official plugin structural check
ANTHROPIC_API_KEY=xxx npm run eval             # live routing-quality eval (red line: falseDowngradeRate ≈ 0)
```

For an end-to-end smoke test of the plugin itself:

```bash
claude plugin marketplace add .                # add this repo as a local marketplace
claude plugin install smart-dispatch@smart-dispatch
claude plugin details smart-dispatch           # should list Skills (1): smart-dispatch
# ... exercise it in a session, then clean up:
claude plugin uninstall smart-dispatch
claude plugin marketplace remove smart-dispatch
```

## Commit & PR style

- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `refactor:`), one logical change per commit.
- Keep commits focused and reviewable.
- Open a PR against `master`; CI must be green.
- Do **not** add `Co-Authored-By` trailers for AI assistants — this repo's history intentionally attributes all work to human authors.

## Notes

- The eval harness (`eval/run-eval.js`) is not unit-tested (it calls the live API). Its pure helpers (`decideModel`, `parseRouterOutput`, `computeMetrics`) are — extend those rather than putting logic in the harness.
- The eval's `savingsRate` varies ~±0.01 run-to-run (Haiku's Routine classification is mildly non-deterministic); `falseDowngradeRate` should stay `0`.
- By contributing you agree your changes are licensed under the project's [MIT license](./LICENSE).
