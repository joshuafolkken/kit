import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { rule_list } from './rule-list'
import { stop_rule_rows, type StopRule } from './stop-rule-rows'

// joshuafolkken/kit#3399: the delivered-rule list is rendered from `delivered-rules.ts`, so a row added
// there reaches the list without a document edit. joshuafolkken/kit#4184: each row carries its own
// description, so the type rules out a row without one; these pin that every field is filled.

const ROWS: ReadonlyArray<StopRule> = [...delivered_rules.MEASURED_RULES, ...stop_rule_rows.ROWS]

describe('rule_list.render — every row is listed', () => {
	const rendered = rule_list.render()

	it.each(ROWS.map((rule) => rule.id))('lists %s', (id) => {
		expect(rendered).toContain(`\`${id}\``)
	})

	it('prints why each row is not automated, with none missing', () => {
		expect(rendered).toContain('  - not automated: ')
		expect(rendered).not.toContain(rule_list.MISSING_WHY)
	})

	it('names each entry point', () => {
		for (const entry of ['rule:guard', 'stop:guard', 'batch:guard', 'investigation:guard']) {
			expect(rendered).toContain(`pnpm josh ${entry}`)
		}
	})
})

describe('the rule table — one filled row per id', () => {
	it.each(ROWS.map((rule) => [rule.id, rule] as const))('%s fills every field', (_id, rule) => {
		const { title, topic, fires, quiet } = rule.about

		for (const field of [title, topic, fires, quiet]) expect(field.trim()).not.toBe('')
	})

	it('has no duplicate id', () => {
		const ids = ROWS.map((rule) => rule.id)

		expect(new Set(ids).size).toBe(ids.length)
	})
})
