export const meta = {
  name: 'smart-dispatch-batch',
  description:
    'Batch quality-first routing with budget-adaptive downgrade. Routes each task with the light tier, defaults to heavy, downgrades only confident trivial/routine tasks, and steps heavy→mid when the remaining budget drops below the floor.',
  phases: [
    { title: 'Route', detail: 'classify each task with the light tier' },
    { title: 'Execute', detail: 'dispatch each task on the chosen slot' },
  ],
}

// ── Policy (INLINED) ──────────────────────────────────────────────────────
// Workflow scripts run in a sandbox and CANNOT import local modules, so the
// policy is duplicated here. Source of truth: src/decide-model.js — KEEP IN
// SYNC. The only additions over the core policy: reading the live `budget`
// to allow heavy→mid when the remaining budget drops below the floor, and
// the WIRE map — decisions are canonical slots (light/mid/heavy), the
// sandbox's agent() calls take host wire names.
// ──────────────────────────────────────────────────────────────────────────
const DOWNGRADE_THRESHOLD = 0.8
const BUDGET_FLOOR = 0.1
const WIRE = { light: 'haiku', mid: 'sonnet', heavy: 'opus' }

function chooseModel(tier, confidence) {
  const safe = Number.isFinite(confidence) && confidence >= 0 ? confidence : 0
  const downgradeable =
    (tier === 'Trivial' || tier === 'Routine') && safe >= DOWNGRADE_THRESHOLD
  let model = downgradeable ? (tier === 'Trivial' ? 'light' : 'mid') : 'heavy'
  // Budget-adaptive: the ONLY allowed downward override of heavy.
  if (model === 'heavy' && budget.total && budget.remaining() < budget.total * BUDGET_FLOOR) {
    model = 'mid'
  }
  return model
}

const ROUTE_SCHEMA = {
  type: 'object',
  required: ['tier', 'confidence'],
  additionalProperties: false,
  properties: {
    tier: { type: 'string', enum: ['Trivial', 'Routine', 'Hard'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string' },
  },
}

const short = (t) => String(t).slice(0, 40)
const routePrompt = (task) =>
  'Classify this coding task\'s difficulty. Output JSON only.\n' +
  'Trivial = search/grep/read config/list files/string lookup (light);\n' +
  'Routine = clear-pattern edit/summarize/format/template (mid);\n' +
  'Hard = reasoning/design/debug/multi-file/new code/architecture (heavy).\n' +
  'When unsure, pick Hard and lower confidence.\n\nTask: ' + task

// args: a single task string, or an array of task strings.
const tasks = args == null ? [] : Array.isArray(args) ? args.filter(Boolean) : [args]
if (tasks.length === 0) {
  log('smart-dispatch-batch: no tasks provided — pass one task or an array of tasks as args')
  return { count: 0, byModel: {}, results: [] }
}

phase('Route')
const results = await pipeline(
  tasks,
  // stage 1 — route with the cheap classifier (light tier on the wire)
  (task) =>
    agent(routePrompt(task), {
      model: WIRE.light,
      schema: ROUTE_SCHEMA,
      phase: 'Route',
      label: `route:${short(task)}`,
    }).catch(() => ({ tier: 'Hard', confidence: 0 })),
  // stage 2 — execute on the chosen slot (translated to the wire name)
  (route, task) => {
    const tier = route?.tier ?? 'Hard'
    const confidence = route?.confidence ?? 0
    const model = chooseModel(tier, confidence)
    return agent('Do this task: ' + task, {
      model: WIRE[model],
      phase: 'Execute',
      label: `exec(${model}):${short(task)}`,
    }).then((result) => ({ task, tier, confidence, model, result }))
  }
)

const byModel = results.reduce((m, r) => {
  m[r.model] = (m[r.model] || 0) + 1
  return m
}, {})

log(
  `Routed ${results.length} task(s): ${JSON.stringify(byModel)}` +
    (budget.total ? ` (budget remaining: ${Math.round(budget.remaining())})` : '')
)
return { count: results.length, byModel, results }
