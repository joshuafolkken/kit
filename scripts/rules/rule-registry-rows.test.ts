import { describe, expect, it } from 'vitest'
import { rule_registry_rows, type RegisteredRule } from './rule-registry-rows'

// joshuafolkken/kit#3399: the `rule:guard` rows render as list items, so each needs every field and is
// delivered by `rule:guard` itself.

function fields(row: RegisteredRule): ReadonlyArray<string> {
	return [row.id, row.title, row.topic, row.entry, row.fires, row.quiet]
}

const ROWS = rule_registry_rows.GUARD_ROWS.map((row) => [row.id, row] as const)

describe('rule_registry_rows.GUARD_ROWS — each row renders as a full item', () => {
	it.each(ROWS)('%s fills every field', (_id, row) => {
		for (const value of fields(row)) expect(value.trim()).not.toBe('')
	})

	it.each(ROWS)('%s is delivered by rule:guard', (_id, row) => {
		expect(row.entry).toBe(rule_registry_rows.RULE_GUARD)
	})
})
