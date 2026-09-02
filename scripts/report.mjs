#!/usr/bin/env node
// Print smart-dispatch routing stats from the local log.
// Log path: $SMART_DISPATCH_LOG or ~/.smart-dispatch/log.jsonl
//
// Usage:
//   npm run report [--today | --since 7d | --since 2026-08-01] [--json]
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseLog, summarizeEntries, filterSince } from '../src/routing-log.js'
import { PRICE_TABLE } from '../src/compute-metrics.js'
import { loadConfig } from '../src/config.js'

const logPath = process.env.SMART_DISPATCH_LOG || join(homedir(), '.smart-dispatch', 'log.jsonl')

// --since accepts "7d"-style spans or an ISO date; --today = local midnight.
function parseArgs(argv) {
  const out = { json: false, today: false, since: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') out.json = true
    else if (argv[i] === '--today') out.today = true
    else if (argv[i] === '--since') out.since = argv[++i]
  }
  return out
}

function sinceMs(since) {
  const span = since?.match(/^(\d+)\s*([smhdw])$/i)
  if (span) {
    const n = Number(span[1])
    const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[span[2].toLowerCase()]
    return Date.now() - n * unit
  }
  const ts = Date.parse(since)
  return Number.isFinite(ts) ? ts : null
}

const args = parseArgs(process.argv.slice(2))
let entries
try {
  entries = parseLog(readFileSync(logPath, 'utf8'))
} catch {
  console.log(`No routing log found at ${logPath}.`)
  console.log('Entries appear once smart-dispatch routes its first sub-agent dispatch.')
  process.exit(0)
}

let windowLabel = 'all time'
if (args.today) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  entries = filterSince(entries, start.getTime())
  windowLabel = 'today'
} else if (args.since) {
  const from = sinceMs(args.since)
  if (from === null) {
    console.error(`--since: cannot parse "${args.since}" (use e.g. 7d, 24h, or 2026-08-01)`)
    process.exit(1)
  }
  entries = filterSince(entries, from)
  windowLabel = `since ${new Date(from).toISOString().slice(0, 10)}`
}

// Savings is an estimate — label it with the price table it used, and let the
// config file override the table when relative prices drift.
const config = loadConfig()
const relativeCost = config.priceTable || PRICE_TABLE.relative
const s = summarizeEntries(entries, { relativeCost })

if (args.json) {
  console.log(JSON.stringify({ window: windowLabel, priceTable: config.priceTable ? 'config override' : `v${PRICE_TABLE.version} (${PRICE_TABLE.asOf})`, ...s }, null, 2))
  process.exit(0)
}

if (s.count === 0) {
  console.log(`No routing decisions ${windowLabel === 'all time' ? 'yet' : windowLabel} in ${logPath}.`)
  process.exit(0)
}

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`)
const dist = (obj) => Object.entries(obj).map(([k, c]) => `${k} ${c}`).join(' · ') || 'none'

console.log(`smart-dispatch — ${s.count} routing decision(s), ${windowLabel}`)
console.log(`  models: ${dist(s.byModel)}`)
if (Object.keys(s.byTier).length) console.log(`  tiers: ${dist(s.byTier)}`)
if (Object.keys(s.byAgent).length) console.log(`  agents: ${dist(s.byAgent)}`)
console.log(`  estimated savings vs all-opus: ${pct(s.savingsRate)} (price table ${config.priceTable ? 'config override' : `v${PRICE_TABLE.version}, ${PRICE_TABLE.asOf}`})`)
console.log(`  Hard-tier tasks downgraded (budget mode): ${pct(s.hardDowngraded)}`)
console.log(`  self-healed retries (escalated back to opus): ${s.escalations}`)
console.log(`\nLog: ${logPath}`)
