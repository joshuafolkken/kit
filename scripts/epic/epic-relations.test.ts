import { session_cite } from '#scripts/issue/session-cite'
import { describe, expect, it } from 'vitest'
import { epic_relations } from './epic-relations'

// joshuafolkken/kit#1080 — the report used to be a bare count, and a count cannot be checked: an
// insertion that recorded an order nobody declared printed the same line as a correct one, so the
// invented chains were caught only by whoever opened the epic body afterwards.

const LINKS = [
	{ blocker: 1228, blocked: 1248 },
	{ blocker: 1248, blocked: 1249 },
]
// joshuafolkken/kit#3424: the report is printed to the session, so the numbers it names are linked.
const RECORDED = session_cite.text(
	'🔗 2 blocked-by relation(s) recorded: #1228 -> #1248, #1248 -> #1249.',
)
const REMOVED = session_cite.text('🔗 1 blocked-by relation(s) removed: #1228 -> #1248.')

describe('epic_relations.format_relation_report — what it names', () => {
	it('names every relation it recorded', () => {
		const report = epic_relations.format_relation_report({
			links: LINKS,
			failures: 0,
			action: 'record',
		})

		expect(report).toBe(RECORDED)
	})

	it('names every relation it removed', () => {
		const report = epic_relations.format_relation_report({
			links: [LINKS[0] ?? { blocker: 0, blocked: 0 }],
			failures: 0,
			action: 'drop',
		})

		expect(report).toBe(REMOVED)
	})

	it('says so plainly when there was nothing to name', () => {
		const report = epic_relations.format_relation_report({
			links: [],
			failures: 0,
			action: 'record',
		})

		expect(report).toBe('🔗 No blocked-by relation was recorded.')
	})

	// `apply_relations` reports how many writes failed, not which, so naming the whole set here would
	// assert more than is known.
	it('reports a failure as a count, without naming a link', () => {
		const report = epic_relations.format_relation_report({
			links: LINKS,
			failures: 1,
			action: 'record',
		})

		expect(report).toContain('1 of 2 blocked-by relation(s) could not be recorded')
		expect(report).not.toContain('#1228')
	})
})
