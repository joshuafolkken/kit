import { describe, expect, it } from 'vitest'
import { rule_registry } from './rule-registry'

// joshuafolkken/kit#3399: the registry join `rule:list` renders through — a guard row's id finds its
// entry, and every generated `oracle-consulted:<name>` id finds the one shared oracle entry.

const ORACLE_ENTRY = 'oracle-consulted'
const ORACLE_ROW = `${ORACLE_ENTRY}:pkg-scout`

describe('rule_registry.registry_id — the entry id a guard row reads', () => {
	it('reads a generated oracle id as the shared oracle entry', () => {
		expect(rule_registry.registry_id(ORACLE_ROW)).toBe(ORACLE_ENTRY)
	})

	it('keeps any other id as it is', () => {
		const id = 'shell-body'

		expect(rule_registry.registry_id(id)).toBe(id)
	})
})

describe('rule_registry.entry_for — the entry a guard row is rendered from', () => {
	it('finds the entry of a guard row', () => {
		expect(rule_registry.entry_for('third-party-write')?.title).toBe('Third-party write')
	})

	it('finds the oracle entry for a generated oracle id', () => {
		expect(rule_registry.entry_for(ORACLE_ROW)?.id).toBe(ORACLE_ENTRY)
	})

	it('finds nothing for an unknown id', () => {
		expect(rule_registry.entry_for('no-such-rule')).toBeUndefined()
	})
})

describe('rule_registry.REGISTERED_RULES — one entry per id', () => {
	it('has no duplicate id', () => {
		const ids = rule_registry.REGISTERED_RULES.map((rule) => rule.id)

		expect(new Set(ids).size).toBe(ids.length)
	})
})
