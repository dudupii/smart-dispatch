// Heuristic task classifier for the PreToolUse hook.
//
// This is the FALLBACK engine used when a sub-agent is dispatched WITHOUT the
// skill being invoked (i.e. the model called the Agent tool directly). It is
// deliberately conservative: it only ever flags read-only Explore tasks as
// Trivial/Routine, and only when the prompt carries no hard signal. Everything
// else returns Unknown/low-confidence → decideModel keeps it on opus.
//
// Why so narrow: heuristics can misjudge. The smart-dispatch invariant is
// "never lose quality to a routing mistake" — the only acceptable error is
// treating a simple task as hard (a little wasted spend). So we downgrade only
// on the safest possible surface (read-only search agents).
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

  // 2. MVP scope: only read-only Explore agents are safe to downgrade.
  //    general-purpose / Plan / code-reviewer / custom agents stay on opus.
  if (subagent_type !== 'Explore') {
    return { tier: 'Unknown', confidence: 0, reason: 'non-Explore → leave at opus' }
  }

  const text = `${description || ''} ${prompt || ''}`.toLowerCase()
  const len = (prompt || '').length

  // 3. Any hard signal → Hard, below threshold. decideModel keeps opus.
  if (HARD_WORDS.some((w) => text.includes(w))) {
    return { tier: 'Hard', confidence: 0.6, reason: 'hard keyword in Explore prompt' }
  }

  // 4. Confident trivial: short read-only task with a search verb.
  if (len < 1500 && SEARCH_WORDS.some((w) => text.includes(w))) {
    return { tier: 'Trivial', confidence: 0.85, reason: 'read-only search' }
  }
  if (len < 600) {
    return { tier: 'Trivial', confidence: 0.82, reason: 'short read-only task' }
  }

  // 5. Medium Explore, no hard signal → routine read. sonnet is safe.
  if (len < 4000) {
    return { tier: 'Routine', confidence: 0.8, reason: 'routine read-only' }
  }

  // 6. Very long Explore → uncertain, keep opus.
  return { tier: 'Unknown', confidence: 0, reason: 'long Explore → leave at opus' }
}
