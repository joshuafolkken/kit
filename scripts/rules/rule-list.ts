#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { delivered_rules } from './delivered-rules'
import { guard_remedy } from './guard-remedy'
import { stop_rule_rows, type StopRule } from './stop-rule-rows'

// `josh rule:list` — the list of trigger-delivered rules, rendered from the guard rows themselves.
// One item per `MEASURED_RULES` row in delivery order, then the `Stop`
// hook's rows; each carries its single source, the call it fires on and the turn it stays silent on.
// The prose is each row's own `about`, so a row added there is listed without a document edit.

const HEADER =
	'# Trigger-delivered rules — rendered by `pnpm josh rule:list` from `scripts/rules/delivered-rules.ts`'
const MISSING_WHY = '(no `why` in `scripts/rules/guard-remedy.ts`)'

function item({ id, about }: StopRule): string {
	return [
		`- **${about.title}** (\`${id}\`, ${about.topic})`,
		`  - fires: \`${about.entry ?? delivered_rules.RULE_GUARD}\` — ${about.fires}`,
		`  - silent: ${about.quiet}`,
		`  - not automated: ${guard_remedy.why_of(id) ?? MISSING_WHY}`,
	].join('\n')
}

function render(): string {
	const rows = [...delivered_rules.MEASURED_RULES, ...stop_rule_rows.ROWS].map((rule) => item(rule))

	return [HEADER, '', ...rows].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(`${render()}\n`)

const rule_list = { MISSING_WHY, render }

export { rule_list }
