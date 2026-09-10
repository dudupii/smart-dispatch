// smart-dispatch — the Pi extension (spec #10, Pi phase).
//
// Pi runs one model per session with one agent loop per user prompt, so
// quality-first routing translates to per-prompt session routing: confidently
// trivial/routine prompts step the session down for that loop, everything
// else restores the session base (the model in effect when routing first
// ran). Routing never selects above the base and stands down entirely once
// the user picks a model themselves (/model, Ctrl+P) — user override wins.
//
// All decisions come from the shared core (src/dispatch-pipeline.js via
// src/pi-router.js); this file is marshalling only. Config is read once per
// session; SMART_DISPATCH_DRY=1 previews decisions in the log without
// switching models.

import { createPiRouter } from '../../src/pi-router.js'
import { appendLogEntry, readLogTail } from '../../src/routing-log.js'
import { loadConfig } from '../../src/config.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

const logPath = () =>
  process.env.SMART_DISPATCH_LOG || join(homedir(), '.smart-dispatch', 'log.jsonl')

export default function smartDispatch(pi) {
  const config = loadConfig()
  const dryRun = ['1', 'true'].includes(String(process.env.SMART_DISPATCH_DRY || '').toLowerCase())

  // Our own model switches must not look like user selections — model_select
  // can fire for programmatic setModel too. Guard by flag + a short window.
  let applying = false
  let lastSelfSetAt = 0

  const router = createPiRouter({
    config,
    findModel: () => null, // concrete-model resolution goes through ctx.modelRegistry
    setModel: async (model) => {
      applying = true
      lastSelfSetAt = Date.now()
      try {
        await pi.setModel(model)
      } finally {
        applying = false
      }
    },
    logEntry: (entry) => appendLogEntry(logPath(), entry),
    readEntries: () => readLogTail(logPath()),
  })

  pi.on('model_select', async (event) => {
    if (applying || Date.now() - lastSelfSetAt < 1000) return // our own switch
    router.onModelSelect(event.source)
  })

  pi.on('before_agent_start', async (event, ctx) => {
    const decision = await router.onPrompt(event.prompt ?? '', ctx)
    if (!decision?.rewrite || dryRun) return
    ctx.ui?.notify?.(`smart-dispatch → ${decision.rewrite}`, 'info')
  })
}
