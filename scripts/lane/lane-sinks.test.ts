import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_breakdown } from './lane-breakdown'
import type { LedgerEntry } from './lane-ledger'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_measure_cli } from './lane-measure-cli'
import { lane_over } from './lane-over'
import { lane_sinks } from './lane-sinks'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#5701: the stages the period's lanes over the threshold spent their time in, summed
// over every such lane's breakdown and its laps, the longest total first.

const MINUTE_MS = 60_000
const START = Date.parse('2026-10-26T00:00:00.000Z')
const WINDOW = { since_ms: START, until_ms: START + 1000 * MINUTE_MS }
const LONG = 101
const LONGER = 102
const SHORT = 103
const HUB_LANE = 104
const THRESHOLD = 30
const FOLLOWUP_CI = 'followup CI'
const SHIP_STAGE = 'ship-stage'

const scratch = make_directory('lane-sinks-test-')

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

function event(minute: number, kind: string, text: string): RunEvent {
	return { pos: minute, at: at(minute), kind, text }
}

interface LaneShape {
	issue: number
	from: number
	plan: number
	followup: number
	merge: number
}

function lane_entries({ issue, from, merge }: LaneShape): Array<LedgerEntry> {
	return [
		{ kind: 'dispatch', at: at(from), issue },
		{ kind: 'merge', at: at(merge), issue },
	]
}

// Start to plan, implement up to the followup, then the followup up to the merge.
function lane_events({ issue, plan, followup }: LaneShape): Array<RunEvent> {
	const cite = `#${String(issue)}`

	return [
		event(plan, 'plan', `${cite} plan`),
		event(plan, 'lane-phase', `${cite} implement`),
		event(followup, SHIP_STAGE, `${cite} followup start`),
	]
}

function followup_lap(issue: number, ended: number, minutes: number): LedgerEntry {
	const elapsed_ms = minutes * MINUTE_MS

	return {
		kind: 'ship-lap',
		at: at(ended),
		issue,
		stage: 'followup',
		step: FOLLOWUP_CI,
		elapsed_ms,
	}
}

// Two lanes over the threshold, one under it.
const LANES: ReadonlyArray<LaneShape> = [
	{ issue: LONG, from: 0, plan: 10, followup: 40, merge: 50 },
	{ issue: LONGER, from: 100, plan: 105, followup: 140, merge: 145 },
	{ issue: SHORT, from: 200, plan: 205, followup: 215, merge: 220 },
]

const RECORDS = {
	entries: [
		...LANES.flatMap((lane) => lane_entries(lane)),
		followup_lap(LONG, 45, 4),
		{ ...followup_lap(LONGER, 144, 3), rerun: 'flake', runs: 2 },
	],
	events: LANES.flatMap((lane) => lane_events(lane)),
}

function minutes_of(per_lane_ms: ReadonlyArray<number>): Array<number> {
	return per_lane_ms.map((ms) => ms / MINUTE_MS)
}

describe('lane_sinks.over_issues', () => {
	it('keeps the merged lanes over the threshold', () => {
		expect(lane_sinks.over_issues(RECORDS, WINDOW, THRESHOLD)).toStrictEqual([LONG, LONGER])
	})

	it('reads the net time unrounded, so a lane just under a fractional threshold stays out', () => {
		const lane = { issue: SHORT, from: 0, plan: 0, followup: 0, merge: 30.2 }
		const records = { entries: lane_entries(lane), events: [] }

		expect(lane_sinks.over_issues(records, WINDOW, 30.5)).toStrictEqual([])
	})
})

describe('lane_sinks.sinks_of', () => {
	const sinks = lane_sinks.sinks_of(RECORDS, [LONG, LONGER])

	it('sums each stage over the lanes, the longest total first', () => {
		expect(sinks.map((sink) => [sink.name, minutes_of(sink.per_lane_ms)])).toStrictEqual([
			['implement', [30, 35]],
			['start to plan', [10, 5]],
		])
	})

	// joshuafolkken/kit#6541: the followup is the driver's wait, outside the lanes' net time.
	it('leaves out the driver followup and its laps', () => {
		const names = sinks.map((sink) => sink.name)

		expect(names).not.toContain(lane_breakdown.FOLLOWUP_STAGE)
		expect(names).not.toContain(FOLLOWUP_CI)
	})
})

describe('lane_sinks.table', () => {
	it('prints one row per stage of the lanes over the threshold', () => {
		const rows = lane_sinks.table(RECORDS, WINDOW, THRESHOLD, []).split('\n')

		expect(rows[0]).toBe('| stage | total min | lanes | median min | open issues |')
		expect(rows[2]).toBe('| implement | 65.0 | 2 | 32.5 | none |')
		expect(rows).toHaveLength(4)
	})

	it('names the open Issues whose title carries the stage on its row', () => {
		const issues = [{ number: 7, title: 'Trim the Implement stage' }]
		const rows = lane_sinks.table(RECORDS, WINDOW, THRESHOLD, issues).split('\n')

		expect(rows[2]).toBe('| implement | 65.0 | 2 | 32.5 | #7 |')
	})
})

function test_related(issue: number, minute: number, over_cap_hub: string): LedgerEntry {
	return {
		kind: 'test-related',
		at: at(minute),
		issue,
		scope: 'related',
		changed: 3,
		synced: 0,
		since_map: 0,
		readers: 1,
		over_cap: 2,
		over_cap_hub,
		elapsed_ms: 1000,
	}
}

const SCOPED_PAIR = 'scoped pair'
const ALIASES_HUB = 'scripts/josh/josh-aliases.ts'
const HUB_ISSUES = [
	{ number: 21, title: 'Narrow the josh-aliases.ts test reach' },
	{ number: 22, title: 'Narrow the short-hub.ts test reach' },
]

function scoped_pair_lap(issue: number, ended: number, minutes: number): LedgerEntry {
	return {
		kind: 'ship-lap',
		at: at(ended),
		issue,
		stage: 'gate',
		step: SCOPED_PAIR,
		elapsed_ms: minutes * MINUTE_MS,
	}
}

// The ship gate the scoped pair ran in, before the followup outside the net time.
function gate_events(issue: number, from: number, to: number): Array<RunEvent> {
	const cite = `#${String(issue)}`

	return [event(from, SHIP_STAGE, `${cite} gate start`), event(to, SHIP_STAGE, `${cite} gate done`)]
}

// joshuafolkken/kit#6198: the scoped pair row also cites the Issues naming the period's over-cap hubs.
describe('lane_sinks.table — the scoped pair row', () => {
	const records = {
		entries: [
			...RECORDS.entries,
			scoped_pair_lap(LONG, 39, 1),
			test_related(LONG, 20, ALIASES_HUB),
			test_related(SHORT, 210, 'scripts/lane/short-hub.ts'),
		],
		events: [...RECORDS.events, ...gate_events(LONG, 38, 39)],
	}
	const rows = lane_sinks.table(records, WINDOW, THRESHOLD, HUB_ISSUES).split('\n')

	it('cites the Issue naming an over-threshold lane hub on the scoped pair row alone', () => {
		expect(rows).toContain('| scoped pair | 1.0 | 1 | 1.0 | #21 |')
		expect(rows.filter((row) => row.includes('#21'))).toHaveLength(1)
	})

	it('leaves out the hub of a lane under the threshold', () => {
		expect(rows.some((row) => row.includes('#22'))).toBe(false)
	})

	it('matches a lane whose top stage is the scoped pair the same way under --over', () => {
		const lane = { issue: HUB_LANE, from: 300, plan: 301, followup: 351.5, merge: 352 }
		const lane_records = {
			entries: [
				...lane_entries(lane),
				scoped_pair_lap(HUB_LANE, 351, 60),
				test_related(HUB_LANE, 301, ALIASES_HUB),
			],
			events: [...lane_events(lane), ...gate_events(HUB_LANE, 340, 351.5)],
		}

		expect(lane_over.table(lane_records, WINDOW, THRESHOLD, HUB_ISSUES)).toContain(
			'| scoped pair | #21 |',
		)
	})
})

describe('lane_sinks.hubs_of', () => {
	it('lists each distinct hub of the named lanes, the first named first', () => {
		const entries = [
			test_related(LONG, 1, 'b.ts'),
			test_related(LONGER, 2, 'a.ts'),
			test_related(LONG, 3, 'b.ts'),
			test_related(SHORT, 4, 'c.ts'),
		]

		expect(lane_sinks.hubs_of(entries, [LONG, LONGER])).toStrictEqual(['b.ts', 'a.ts'])
	})
})

// A ledger holding the three lanes' dispatch and merge, read at a clock past them all.
function seeded_context(): {
	ledger_path: string
	events_path: string
	transcript_directories: Array<string>
	now_ms: number
} {
	const context = {
		ledger_path: path.join(scratch, `${randomUUID()}.jsonl`),
		events_path: path.join(scratch, `${randomUUID()}-events.jsonl`),
		transcript_directories: [],
		now_ms: START + 300 * MINUTE_MS,
	}
	const entries = LANES.flatMap((lane) => lane_entries(lane))

	for (const entry of entries) lane_ledger_write.append(context.ledger_path, entry)

	return context
}

describe('lane_measure_cli.run — stats --sinks', () => {
	beforeEach(() => {
		vi.spyOn(console, 'info').mockReturnValue(undefined)
		vi.spyOn(console, 'error').mockReturnValue(undefined)
		vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({ json: '[]', is_capped: false })
	})

	it('names the sinks form in the usage it prints', () => {
		expect(lane_measure_cli.USAGE).toContain('josh lane:stats --period <days> --sinks [<minutes>]')
	})

	it('refuses a lane limit beside --sinks, which labels no limit', async () => {
		const argv = ['stats', '--period', '1', '--limit', '4', '--sinks']

		await expect(lane_measure_cli.run(argv, {})).resolves.toBe(1)
	})

	it('prints the sinks table alone, the default threshold dropping the short lane', async () => {
		await expect(
			lane_measure_cli.run(['stats', '--period', '1', '--sinks'], seeded_context()),
		).resolves.toBe(0)

		const printed = String(vi.mocked(console.info).mock.calls[0]?.[0])

		expect(printed).toMatch(/^\| stage \| total min/u)
		expect(printed).toContain('| 2 |')
		expect(printed).toContain('| none |')
	})

	it('reads an explicit threshold, keeping only the lane over it', async () => {
		const argv = ['stats', '--period', '1', '--sinks', '46']

		await expect(lane_measure_cli.run(argv, seeded_context())).resolves.toBe(0)

		expect(String(vi.mocked(console.info).mock.calls[0]?.[0])).toContain('| 1 |')
	})
})
