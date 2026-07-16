#!/usr/bin/env node
// Reproducible demo of smart-dispatch routing decisions.
//
// Drives the REAL PreToolUse-hook heuristic classifier + quality-first policy
// on representative tasks, so the output reflects actual shipped behavior.
// Used by docs/demo.tape to render docs/demo.gif.
//
//   node scripts/demo.mjs

import { classifyHeuristic } from '../src/classify-heuristic.js'
import { decideModel } from '../src/decide-model.js'

const useColor = process.stdout.isTTY
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const model = (m) => ({ opus: '32', sonnet: '33', haiku: '36' }[m] ? c({ opus: '32;1', sonnet: '33', haiku: '36' }[m], m.padEnd(6)) : m)
const dim = (s) => c('2;90', s)

// (label is for display; prompt is what the classifier actually sees.)
const tasks = [
  {
    label: 'Explore · grep usages of decideModel',
    agent: 'Explore',
    prompt: 'grep for all usages of decideModel across the repo',
  },
  {
    label: 'Explore · walk through hooks/ control flow (verbose)',
    agent: 'Explore',
    prompt: 'Walk through the contents of the hooks directory: tell me what each file is responsible for, how the route hook is wired into the lifecycle, what the policy module exports, and how the two code paths (automatic hook and explicit skill) end up sharing the same decision logic. Mention the names of the key functions, a short note on the control flow from tool call to the model being chosen, and anything a new contributor should keep in mind about the conservative downgrade rules before changing them. Also note which functions are imported by the demo script and how the threshold constant affects whether a task stays on the strongest model or steps down to a cheaper one.',
  },
  {
    label: 'Explore · "design a caching layer…"',
    agent: 'Explore',
    prompt: 'design a caching layer so routing results are reused across dispatches',
  },
  {
    label: 'general-purpose · implement login + tests',
    agent: 'general-purpose',
    prompt: 'implement the login flow and write tests',
  },
  {
    label: 'Explore · explicit model: sonnet',
    agent: 'Explore',
    prompt: 'grep the changelog for v0.2',
    model: 'sonnet',
  },
]

function route(t) {
  const cls = classifyHeuristic({ subagent_type: t.agent, prompt: t.prompt, description: '', model: t.model })
  if (cls.skip) return { model: t.model, tier: 'override', conf: '—', note: 'respected, not routed' }
  const d = decideModel({ tier: cls.tier, confidence: cls.confidence })
  return {
    model: d.model,
    tier: cls.tier,
    conf: cls.confidence.toFixed(2),
    note: d.downgraded ? dim('↓ downgrade') : dim('kept (quality-first)'),
  }
}

const W = { task: 46, tier: 10, conf: 6 }
const head = `  ${'Task'.padEnd(W.task)}  ${'Tier'.padEnd(W.tier)}${'Conf'.padEnd(W.conf)}  Model`
const rule = dim('  ' + '─'.repeat(head.length - 2))

console.log(c('1;35', '\n  smart-dispatch') + c('2;90', ' — quality-first model routing (PreToolUse hook)\n'))
console.log(head)
console.log(rule)

for (const t of tasks) {
  const r = route(t)
  const label = t.label.length > W.task ? t.label.slice(0, W.task - 1) + '…' : t.label.padEnd(W.task)
  console.log(`  ${label}  ${r.tier.padEnd(W.tier)}${r.conf.toString().padEnd(W.conf)}  ${model(r.model)}  ${r.note}`)
}

console.log(dim('\n  Hard tasks, uncertain tasks, and non-Explore agents stay on opus.'))
console.log(dim('  Only confident read-only tasks downgrade — never lose quality to a routing mistake.\n'))
