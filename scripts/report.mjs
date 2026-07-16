#!/usr/bin/env node
// Print smart-dispatch routing stats from the local log.
// Log path: $SMART_DISPATCH_LOG or ~/.smart-dispatch/log.jsonl
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseLog, summarizeEntries } from '../src/routing-log.js'

const logPath = process.env.SMART_DISPATCH_LOG || join(homedir(), '.smart-dispatch', 'log.jsonl')

let text
try {
  text = readFileSync(logPath, 'utf8')
} catch {
  console.log(`No routing log found at ${logPath}.`)
  console.log('Entries appear once the smart-dispatch skill routes its first sub-agent dispatch.')
  process.exit(0)
}

const s = summarizeEntries(parseLog(text))

if (s.count === 0) {
  console.log(`Log at ${logPath} has no entries yet.`)
  process.exit(0)
}

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`)
const dist = Object.entries(s.byModel).map(([m, c]) => `${m} ${c}`).join(' · ') || 'none'

console.log(`smart-dispatch — ${s.count} routing decision(s)`)
console.log(`  models: ${dist}`)
console.log(`  estimated savings vs all-opus: ${pct(s.savingsRate)}`)
console.log(`  Hard-tier tasks downgraded (budget mode): ${pct(s.hardDowngraded)}`)
console.log(`\nLog: ${logPath}`)
