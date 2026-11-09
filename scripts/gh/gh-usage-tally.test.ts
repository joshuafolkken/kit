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

	it("names the session's transport after the heading's period", () => {
		const text = gh_usage_tally.render(gh_usage_tally.tally(LINES), 'rest (auto)')

		expect(text.split('\n', 1)[0]).toBe(
			`gh:usage — ${EARLY} … ${LATE} · 4 lines · transport: rest (auto)`,
		)
	})

	it('prints one line when no usage line is left', () => {
		expect(gh_usage_tally.render(gh_usage_tally.tally(['not json']))).toBe(
			'gh:usage — no usage lines · 1 malformed',
		)
	})
})

// joshuafolkken/kit#6867: the calls per endpoint, beside lines written before kinds were recorded.
const ISSUE_KIND = 'GET repos/{o}/{r}/issues/{n}'

function endpoint_line(calls: number, endpoints: Record<string, [number, number]>): string {
	const counts = Object.entries(endpoints).map(([kind, [kind_calls, not_modified]]) => [
		kind,
		{ calls: kind_calls, not_modified },
	])

	return JSON.stringify({
		...(JSON.parse(line_of(LATE, RUN_STEP, calls)) as object),
		endpoints: Object.fromEntries(counts),
	})
}

const ENDPOINT_LINES = [
	line_of(EARLY, RUN_STEP, 5),
	endpoint_line(6, { [ISSUE_KIND]: [3, 1], graphql: [1, 0], 'GET rate_limit': [2, 0] }),
	endpoint_line(4, { [ISSUE_KIND]: [2, 0], 'gh issue view': [2, 0] }),
]

describe('gh_usage_tally — endpoints', () => {
	it('sums each endpoint across lines, most calls first, and reads a line without any', () => {
		expect(gh_usage_tally.tally(ENDPOINT_LINES).endpoints).toStrictEqual([
			{ endpoint: ISSUE_KIND, calls: 5, not_modified: 1 },
			{ endpoint: 'GET rate_limit', calls: 2, not_modified: 0 },
			{ endpoint: 'gh issue view', calls: 2, not_modified: 0 },
			{ endpoint: 'graphql', calls: 1, not_modified: 0 },
		])
	})

	it('counts a line whose endpoint counts are not numbers as malformed, not tallied', () => {
		const broken = JSON.stringify({
			...(JSON.parse(line_of(LATE, RUN_STEP, 1)) as object),
			endpoints: { [ISSUE_KIND]: { calls: 'one', not_modified: 0 } },
		})
		const result = gh_usage_tally.tally([broken])

		expect(result.malformed).toBe(1)
		expect(result.endpoints).toStrictEqual([])
	})

	it('prints the class totals and the endpoint table below the command table', () => {
		const text = gh_usage_tally.render(gh_usage_tally.tally(ENDPOINT_LINES))

		expect(text.split('\n').slice(3)).toStrictEqual([
			'',
			'REST 5 · GraphQL 1 · gh 2 · rate_limit (free) 2 · unrecorded 5',
			'endpoint                      calls  304',
			`${ISSUE_KIND}      5    1`,
			'GET rate_limit                    2    0',
			'gh issue view                     2    0',
			'graphql                           1    0',
		])
	})
})
