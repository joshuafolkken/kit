#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { delivered_rules } from './delivered-rules'
import { rule_registry, type RegisteredRule } from './rule-registry'

// `josh rule:list` — the list of trigger-delivered rules, rendered from the guard rows themselves.
// One item per `MEASURED_RULES` row in delivery order, then the `Stop`
// hook's rows; each carries its single source, the call it fires on and the turn it stays silent on.
// The prose is `rule-registry.ts`; the order and the set are `delivered-rules.ts`, so a row added
// there is listed without a document edit — and a row with no registry entry is listed as missing.

const HEADER =
	'# Trigger-delivered rules — rendered by `pnpm josh rule:list` from `scripts/rules/delivered-rules.ts`'
const MISSING = '(no entry in `scripts/rules/rule-registry.ts`)'

function item(id: string, rule: RegisteredRule | undefined): string {
	if (rule === undefined) return `- \`${id}\` ${MISSING}`

	return [
		`- **${rule.title}** (\`${id}\`, ${rule.topic})`,
		`  - fires: \`${rule.entry}\` — ${rule.fires}`,
		`  - silent: ${rule.quiet}`,
	].join('\n')
}

function row_ids(): ReadonlyArray<string> {
	return delivered_rules.MEASURED_RULES.map((rule) => rule.id)
}

function render(): string {
	const rows = row_ids().map((id) => item(id, rule_registry.entry_for(id)))
	const stops = rule_registry.STOP_ROWS.map((rule) => item(rule.id, rule))

	return [HEADER, '', ...rows, ...stops].join('\n')
}

// Registry entries no guard row reaches — a renamed or removed row left its prose behind.
function orphans(): ReadonlyArray<string> {
	const reached = new Set(row_ids().map((id) => rule_registry.registry_id(id)))
	const stop_ids = new Set(rule_registry.STOP_ROWS.map((rule) => rule.id))

	return rule_registry.REGISTERED_RULES.map((rule) => rule.id).filter(
		(id) => !reached.has(id) && !stop_ids.has(id),
	)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(`${render()}\n`)

const rule_list = { MISSING, orphans, render }

export { rule_list }
