import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { guard_rule_rows } from './guard-rule-rows'
import { stop_rule_rows } from './stop-rule-rows'

describe('guard_rule_rows.rows', () => {
	it('lists every measured row in delivery order, then the stop hook rows', () => {
		expect(guard_rule_rows.rows()).toStrictEqual([
			...delivered_rules.MEASURED_RULES,
			...stop_rule_rows.ROWS,
		])
	})
})
