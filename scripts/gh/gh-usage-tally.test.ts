import { describe, expect, it } from 'vitest'
import { gh_usage_tally } from './gh-usage-tally'

const EARLY = '2026-11-01T00:00:00.000Z'
const MIDDLE = '2026-11-04T00:00:00.000Z'
const LATE = '2026-11-08T00:00:00.000Z'
const RUN_STEP = 'run:step'
const DIRECT = 'direct:api'

function line_of(at: string, command: string, calls: number, delta?: number): string {
	return JSON.stringify({
		at,
		command,
		calls,
		not_modified: 1,
		core_used_delta: delta,
		elapsed_ms: 10,
	})
}

const LINES = [
	line_of(EARLY, RUN_STEP, 5, 4),
	line_of(MIDDLE, 'followup', 20, 18),
	line_of(MIDDLE, RUN_STEP, 7, 6),
	line_of(LATE, DIRECT, 3),
]

describe('gh_usage_tally.tally', () => {
	it('sums runs, calls, 304s and the core difference per command, most calls first', () => {
		expect(gh_usage_tally.tally(LINES).rows).toStrictEqual([
			{ command: 'followup', runs: 1, calls: 20, not_modified: 1, core_used_delta: 18 },
			{ command: RUN_STEP, runs: 2, calls: 12, not_modified: 2, core_used_delta: 10 },
			{ command: DIRECT, runs: 1, calls: 3, not_modified: 1, core_used_delta: undefined },
		])
	})

	it('orders commands with equal calls by name', () => {
		const lines = [line_of(EARLY, 'b', 2, 1), line_of(EARLY, 'a', 2, 1)]

		expect(gh_usage_tally.tally(lines).rows.map((row) => row.command)).toStrictEqual(['a', 'b'])
	})

	it('keeps only the lines at or after --since', () => {
		const result = gh_usage_tally.tally(LINES, Date.parse(MIDDLE))

		expect(result.lines.map((line) => line.at)).toStrictEqual([MIDDLE, MIDDLE, LATE])
		expect(result.rows.find((row) => row.command === RUN_STEP)?.calls).toBe(7)
	})

	it('counts a line without a core difference in the calls, and sums the ones that carry it', () => {
		const lines = [line_of(EARLY, RUN_STEP, 5), line_of(LATE, RUN_STEP, 7, 6)]

		expect(gh_usage_tally.tally(lines).rows).toStrictEqual([
			{ command: RUN_STEP, runs: 2, calls: 12, not_modified: 2, core_used_delta: 6 },
		])
	})

	it('counts the lines that are not JSON or not a usage line as malformed, not tallied', () => {
		const lines = [...LINES, '{"at":', JSON.stringify({ at: 'yesterday', command: 'x' })]
		const result = gh_usage_tally.tally(lines)

		expect(result.malformed).toBe(2)
		expect(result.lines).toHaveLength(LINES.length)
	})
})

describe('gh_usage_tally.render', () => {
	it('heads the table with the period and line count, the core difference unmeasured as —', () => {
		expect(gh_usage_tally.render(gh_usage_tally.tally(LINES))).toBe(
			[
				`gh:usage — ${EARLY} … ${LATE} · 4 lines`,
				'command     runs  calls  304  core Δ',
				'followup       1     20    1      18',
				'run:step       2     12    2      10',
				'direct:api     1      3    1       —',
			].join('\n'),
		)
	})

	it('names the malformed count in the heading', () => {
		const text = gh_usage_tally.render(gh_usage_tally.tally([...LINES, 'not json']))

		expect(text.split('\n', 1)[0]).toBe(`gh:usage — ${EARLY} … ${LATE} · 4 lines · 1 malformed`)
	})

	it('prints one line when no usage line is left', () => {
		expect(gh_usage_tally.render(gh_usage_tally.tally(['not json']))).toBe(
			'gh:usage — no usage lines · 1 malformed',
		)
	})
})
