import { delivered_rules } from './delivered-rules'
import { stop_rule_rows, type StopRule } from './stop-rule-rows'

// The rows `rule:list` prints: every `MEASURED_RULES` row in delivery order, then the `Stop` hook's.
// Kept apart from `rule-list.ts`, which runs as a script and so cannot be imported.

function rows(): Array<StopRule> {
	return [...delivered_rules.MEASURED_RULES, ...stop_rule_rows.ROWS]
}

const guard_rule_rows = { rows }

export { guard_rule_rows }
