// Evaluation harness: runs the live haiku router over the labeled dataset,
// applies the decideModel policy, and prints quality + cost metrics.
// Manual run: ANTHROPIC_API_KEY=xxx npm run eval

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { parseRouterOutput } from '../src/parse-router-output.js'
import { decideModel } from '../src/decide-model.js'
import { computeMetrics } from '../src/compute-metrics.js'

// Haiku 4.5. Verify the current id via the claude-api skill if this stops resolving.
const ROUTER_MODEL = 'claude-haiku-4-5-20251001'

const ROUTER_PROMPT = `You are a task-difficulty classifier for an AI coding agent. Read the task and output ONLY a JSON object, nothing else:
{"tier":"Trivial"|"Routine"|"Hard","model":"haiku"|"sonnet"|"opus","confidence":0.0-1.0,"reason":"one short phrase"}

- Trivial: pure search, grep, read a config, list files, string lookup  → haiku
- Routine: clear-pattern edit, summarize known content, format, apply a template → sonnet
- Hard: reasoning, design, debug, multi-file logic, new code, architecture → opus
When unsure, pick Hard and lower the confidence.`

const dataset = JSON.parse(readFileSync(new URL('./dataset.json', import.meta.url)))
const client = new Anthropic() // reads ANTHROPIC_API_KEY from env

async function classify(task) {
  const msg = await client.messages.create({
    model: ROUTER_MODEL,
    max_tokens: 200,
    messages: [{ role: 'user', content: `${ROUTER_PROMPT}\n\nTask: ${task}` }],
  })
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  return parseRouterOutput(text)
}

const outcomes = []
for (const [i, item] of dataset.entries()) {
  let parsed = null
  try {
    parsed = await classify(item.task)
  } catch (err) {
    console.error(`[${i + 1}/${dataset.length}] router error: ${err.message}`)
  }
  // decideModel owns the opus fallback: null tier → Unknown → opus.
  const { model: chosen } = decideModel({
    tier: parsed?.tier ?? null,
    confidence: parsed?.confidence,
  })
  outcomes.push({ trueTier: item.expectedTier, chosenModel: chosen })
  const flag = item.expectedTier === 'Hard' && chosen !== 'opus' ? '  ⚠ FALSE-DOWNGRADE' : ''
  console.error(`[${i + 1}/${dataset.length}] ${item.expectedTier.padEnd(8)} → ${chosen}${flag}`)
}

const metrics = computeMetrics(outcomes)
console.log('\n=== smart-dispatch eval ===')
console.log(JSON.stringify(metrics, null, 2))
console.log('\nRed line: falseDowngradeRate should be ~0. Target savingsRate: 0.3–0.5.')
