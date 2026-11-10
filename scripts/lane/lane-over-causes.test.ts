import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_over_causes } from './lane-over-causes'
import type { SinkRecords } from './lane-sinks'

// joshuafolkken/kit#6985: two lanes over 40 net minutes share one over-cap hub and one CI job, and a
// third lane under the threshold shares them too; each cause is one row, filed only when no open
// Issue names it.
const MINUTE_MS = 60_000
const START = Date.parse('2026-11-05T00:00:00Z')
const WINDOW = { since_ms: START, until_ms: START + 120 * MINUTE_MS }
const HUB = 'scripts/run/run-step-section.ts'
const JOB = 'Unit Tests'
const HUB_ISSUE = {
	number: 6198,
	title: 'Split run-step-section.ts so test:related stays under cap',
}
const JOB_ISSUE = { number: 7002, title: 'Shorten the unit tests job' }

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function lane_of(issue: number, minutes: number): Array<LedgerEntry> {
	return [
		{ kind: 'dispatch', issue, at: at(0) },
		{
			kind: 'test-related',
			at: at(1),
			issue,
			scope: 'related',
			changed: 3,
			synced: 0,
			since_map: 0,
			readers: 1,
			over_cap: 2,
			over_cap_hub: HUB,
			elapsed_ms: 1000,
		},
		{
			kind: 'stage',
			at: at(minutes - 1),
			stage: 'ci-wait',
			elapsed_ms: 200_000,
			issue,
			last_check: JOB,
			check_ms: { [JOB]: 157_000 },
		},
		{ kind: 'merge', issue, at: at(minutes) },
	]
}

const RECORDS: SinkRecords = {
	entries: [...lane_of(6901, 60), ...lane_of(6902, 50), ...lane_of(6903, 30)],
	events: [],
}

function lines_of(issues: Parameters<typeof lane_over_causes.table>[3]): Array<string> {
	return lane_over_causes.table(RECORDS, WINDOW, 40, issues).split('\n')
}

describe('lane_over_causes.table', () => {
	it('bundles a cause many lanes share into one row with its lane count and summed overrun', () => {
		const lines = lines_of([])

		expect(lines.filter((line) => line.startsWith('| hub |'))).toStrictEqual([
			`| hub | ${HUB} | 2 | 30.0 | none |`,
		])
		expect(lines.filter((line) => line.includes('| ci job |'))).toStrictEqual([
			'| ci job | unit tests | 2 | 30.0 | none |',
		])
		expect(lines.at(-1)).toBe(`filing candidates: hub ${HUB}, ci job unit tests`)
	})

	it('cites a cause an open Issue names and offers only the rest as filing candidates', () => {
		const lines = lines_of([HUB_ISSUE])

		expect(lines).toContain(`| hub | ${HUB} | 2 | 30.0 | #6198 |`)
		expect(lines.at(-1)).toBe('filing candidates: ci job unit tests')
	})

	it('offers no candidate when every cause has an open Issue', () => {
		expect(lines_of([HUB_ISSUE, JOB_ISSUE]).at(-1)).toBe('filing candidates: none')
	})

	it('offers no candidate when the open-Issue listing was unreadable', () => {
		const lines = lines_of(undefined)

		expect(lines).toContain(`| hub | ${HUB} | 2 | 30.0 | unread |`)
		expect(lines.at(-1)).toBe('filing candidates: unread')
	})
})

describe('lane_over_causes.view', () => {
	it('prints the per-lane chains, then the shared causes', () => {
		const text = lane_over_causes.view(RECORDS, WINDOW, 40, [])

		expect(text.indexOf('| lane |')).toBeLessThan(text.indexOf('| kind |'))
		expect(text).toContain('filing candidates: ')
	})
})
