// Heuristic task classifier for the PreToolUse hook.
//
// This is the FALLBACK engine used when a sub-agent is dispatched WITHOUT the
// skill being invoked (i.e. the model called the Agent tool directly). It is
// deliberately conservative: it only downgrades on the safest surfaces —
// read-only Explore agents (full ladder) and read-only/routine-verb
// general-purpose prompts (narrow gate) — and only when the prompt carries no
// hard signal. Everything else returns Unknown/low-confidence → decideModel
// keeps it on opus.
//
// Why so narrow: heuristics can misjudge. The smart-dispatch invariant is
// "never lose quality to a routing mistake" — the only acceptable error is
// treating a simple task as hard (a little wasted spend). Every widening of
// this surface is gated by the adversarial tests in test/classify-heuristic.test.js
// ("…and fix it" traps must stay on opus); if you extend coverage, extend those
// tests first. Retry-escalation (src/escalation.js) is the safety net when a
// downgrade still slips through.
//
// Mirrors the classification guide in skills/smart-dispatch/SKILL.md.

const HARD_WORDS = [
  'implement', 'design', 'refactor', 'debug', 'architect', 'architecture',
  'write', 'create', 'build', 'fix', 'modify', 'migrate', 'review', 'plan',
  '实现', '设计', '重构', '调试', '架构', '编写', '修复', '修改', '迁移', '审查',
]

const SEARCH_WORDS = [
  'find', 'search', 'grep', 'list', 'locate', 'where', 'lookup', 'read',
  'examine', 'inspect', '查找', '搜索', '列出', '定位', '查看', '检查',
]

// Mechanical, well-scoped verbs — the safe subset of general-purpose work.
// Note substring conservatism: "rewrite" contains "write" (a hard word), so
// tricky phrasings fall to the safe side by construction.
const ROUTINE_WORDS = [
  'summarize', 'format', 'count', 'sort', 'deduplicate',
  '总结', '汇总', '格式化', '统计', '排序',
]

const ROUTINE_GATE_LEN = 1500 // longer general-purpose prompts are too rich to judge by keyword

/**
 * Classify a pending Agent tool call heuristically.
 *
 * @param {object} input
 * @param {string} [input.subagent_type]
 * @param {string} [input.prompt]
 * @param {string} [input.description]
 * @param {string} [input.model] - if already set, caller treats it as an override
 * @returns {{skip?:true, tier:'Trivial'|'Routine'|'Hard'|'Unknown', confidence:number, reason:string}}
 */
export function classifyHeuristic({ subagent_type = '', prompt = '', description = '', model } = {}) {
  // 1. Explicit model choice = override. Never route.
  if (model && String(model).trim()) {
    return { skip: true, tier: 'Unknown', confidence: 0, reason: 'model already set (override)' }
  }

  const text = `${description || ''} ${prompt || ''}`.toLowerCase()
  const len = (prompt || '').length

  // 2. Any hard signal → Hard, below threshold, for EVERY agent type. This
  //    runs before the type gates so a hard verb protects general-purpose
  //    dispatches too ("find the root cause and fix it" must stay on opus).
  if (HARD_WORDS.some((w) => text.includes(w))) {
    return { tier: 'Hard', confidence: 0.6, reason: 'hard keyword in prompt' }
  }

  // 3. Read-only Explore agents — the original, safest surface (full ladder).
  if (subagent_type === 'Explore') {
    if (len < 1500 && SEARCH_WORDS.some((w) => text.includes(w))) {
      return { tier: 'Trivial', confidence: 0.85, reason: 'read-only search' }
    }
    if (len < 600) {
      return { tier: 'Trivial', confidence: 0.82, reason: 'short read-only task' }
    }
    if (len < 4000) {
      return { tier: 'Routine', confidence: 0.8, reason: 'routine read-only' }
    }
    return { tier: 'Unknown', confidence: 0, reason: 'long Explore → leave at opus' }
  }

  // 4. general-purpose — narrow gate: short prompts with an unambiguous
  //    read-only or mechanical verb. Anything else (long, vague, mixed)
  //    stays on opus.
  if (subagent_type === 'general-purpose') {
    if (len < ROUTINE_GATE_LEN && SEARCH_WORDS.some((w) => text.includes(w))) {
      return { tier: 'Trivial', confidence: 0.82, reason: 'read-only search (general-purpose)' }
    }
    if (len < ROUTINE_GATE_LEN && ROUTINE_WORDS.some((w) => text.includes(w))) {
      return { tier: 'Routine', confidence: 0.82, reason: 'mechanical verb (general-purpose)' }
    }
    return { tier: 'Unknown', confidence: 0, reason: 'general-purpose outside safe verbs → leave at opus' }
  }

  // 5. Plan / code-reviewer / custom agents — never downgraded by heuristics.
  return { tier: 'Unknown', confidence: 0, reason: 'non-Explore → leave at opus' }
}
