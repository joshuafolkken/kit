import { describe, expect, it } from 'vitest'
import { issue_human_stops } from './issue-human-stops'
import { ALL_LABELS, PARKED_LABELS } from './issue-labels'

// joshuafolkken/kit#7080: the one list of the stops left to a person, each with its reason.

const { AUTO_RESOLVED_PARK_LABELS, HUMAN_STOPS } = issue_human_stops

describe('issue_human_stops — the registry', () => {
	it.each([...PARKED_LABELS])(
		'holds the park label %s, or names the automatic path that lifts it',
		(label) => {
			const is_listed = issue_human_stops.labels().has(label)

			expect(is_listed || AUTO_RESOLVED_PARK_LABELS.has(label)).toBe(true)
		},
	)

	it.each(HUMAN_STOPS)('gives $key a reason', (stop) => {
		expect(stop.reason.trim()).not.toBe('')
	})

	it('names each stop once', () => {
		const keys = HUMAN_STOPS.map((stop) => stop.key)

		expect(new Set(keys).size).toBe(keys.length)
	})

	it('carries only labels the repository defines', () => {
		for (const label of issue_human_stops.labels()) expect(ALL_LABELS).toContain(label)
	})

	it('keeps a label the run lifts by itself out of the list of a person stops', () => {
		for (const label of AUTO_RESOLVED_PARK_LABELS.keys()) {
			expect(issue_human_stops.labels().has(label)).toBe(false)
		}
	})
})
