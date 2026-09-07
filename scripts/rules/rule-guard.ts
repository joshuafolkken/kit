#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { hook_decision } from '#scripts/josh/hook-decision'
import { delivered_rules } from './delivered-rules'

// The hook entry point for trigger-delivered rules (joshuafolkken/kit#1524).
//
// **It is the same shape `batch-guard.ts` and `investigation-guard.ts` already have**, and
// deliberately so: read the payload on stdin, ask the rule, write the one envelope Claude Code
// understands. What differs is only that this one asks an *enumeration* rather than a single rule —
// so the next rule that leaves residency costs one row in `delivered-rules.ts` and no new process,
// no new settings entry and no new test file.

const rule_delivery = delivered_rules.delivery
const { is_enabled, SWITCH_ENV_KEY } = delivered_rules

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) hook_decision.report_no_payload('rule:guard')
	else hook_decision.write_decision(await text(process.stdin), rule_delivery)
}

export { is_enabled, rule_delivery, SWITCH_ENV_KEY }
