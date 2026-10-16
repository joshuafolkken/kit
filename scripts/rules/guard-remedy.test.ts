import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { guard_remedy } from './guard-remedy'

// The guards composed outside the enumeration, which the table classes all the same.
const COMPOSED_GUARDS = ['duplicate-read', 'run-watcher', 'parent-cut', 'issue-watch']
// The one rewrite `pretool-guard.ts` makes itself rather than through a row.
const FOREGROUND_REWRITE = 'lane-background'

const GUARD_IDS = [...delivered_rules.MEASURED_RULES.map((rule) => rule.id), ...COMPOSED_GUARDS]
const FAMILIES = new Set(GUARD_IDS.map((id) => id.split(':', 1)[0]))
const REWRITE_IDS = new Set(
	delivered_rules.DELIVERED_RULES.filter((rule) => rule.rewrite !== undefined).map(
		(rule) => rule.id,
	),
)

describe('guard_remedy — every PreToolUse guard is classed', () => {
	it.each(GUARD_IDS)('%s has a remedy', (id) => {
		expect(guard_remedy.remedy_of(id)).toBeDefined()
	})

	it.each(Object.keys(guard_remedy.GUARD_REMEDIES))('%s names a guard', (id) => {
		expect(FAMILIES.has(id)).toBe(true)
	})

	it('classes a row family by the prefix before the colon', () => {
		expect(guard_remedy.remedy_of('oracle-consulted:pkg:scout')).toBe('judgment')
	})
})

describe('guard_remedy — the rewrite class matches the rows that rewrite', () => {
	it.each([...REWRITE_IDS])('%s, which carries a rewrite, is classed rewrite', (id) => {
		expect(guard_remedy.is_rewrite(id)).toBe(true)
	})

	const classed = Object.keys(guard_remedy.GUARD_REMEDIES).filter(
		(id) => guard_remedy.is_rewrite(id) && id !== FOREGROUND_REWRITE,
	)

	it.each(classed)('%s, classed rewrite, carries a rewrite', (id) => {
		expect(REWRITE_IDS.has(id)).toBe(true)
	})
})
