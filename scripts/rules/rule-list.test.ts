import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { rule_list } from './rule-list'
import { rule_registry } from './rule-registry'

// joshuafolkken/kit#3399: the delivered-rule list is rendered from `delivered-rules.ts`, so a row added
// there reaches the list without a document edit. These pin both directions of the id join.

describe('rule_list.render — every delivered row is listed', () => {
	const rendered = rule_list.render()

	it.each(delivered_rules.MEASURED_RULES.map((rule) => rule.id))('lists %s', (id) => {
		expect(rendered).toContain(`\`${id}\``)
	})

	it.each(rule_registry.STOP_ROWS.map((rule) => rule.id))('lists the stop row %s', (id) => {
		expect(rendered).toContain(`\`${id}\``)
	})

	it('has a registry entry for every row', () => {
		expect(rendered).not.toContain(rule_list.MISSING)
	})

	it('names each entry point', () => {
		for (const entry of ['rule:guard', 'stop:guard', 'batch:guard', 'investigation:guard']) {
			expect(rendered).toContain(`pnpm josh ${entry}`)
		}
	})
})

describe('rule_list.orphans — no registry entry outlives its row', () => {
	it('finds none', () => {
		expect(rule_list.orphans()).toStrictEqual([])
	})
})
