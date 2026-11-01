import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_measure_cli } from './lane-measure-cli'
import { lane_sinks } from './lane-sinks'

// joshuafolkken/kit#5701: the stages the period's lanes over the threshold spent their time in, summed
// over every such lane's breakdown and its laps, the longest total first.

const MINUTE_MS = 60_000
const START = Date.parse('2026-10-26T00:00:00.000Z')
const WINDOW = { since_ms: START, until_ms: START + 1000 * MINUTE_MS }
const LONG = 101
const LONGER = 102
const SHORT = 103
const THRESHOLD = 30
const FOLLOWUP_CI = 'followup CI'

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-sinks-test-'))

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

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
		event(followup, 'ship-stage', `${cite} followup start`),
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
	{ issue: LONGER, from: 100, plan: 105, followup: 125, merge: 145 },
	{ issue: SHORT, from: 200, plan: 205, followup: 215, merge: 220 },
]

const RECORDS = {
	entries: [
		...LANES.flatMap((lane) => lane_entries(lane)),
		followup_lap(LONG, 45, 4),
		{ ...followup_lap(LONGER, 130, 3), rerun: 'flake', runs: 2 },
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
			['implement', [30, 20]],
			['ship followup', [10, 20]],
			['start to plan', [10, 5]],
			[FOLLOWUP_CI, [4, 3]],
		])
	})
})

describe('lane_sinks.table', () => {
	it('prints one row per stage of the lanes over the threshold', () => {
		const rows = lane_sinks.table(RECORDS, WINDOW, THRESHOLD).split('\n')

		expect(rows[0]).toBe('| stage | total min | lanes | median min |')
		expect(rows[2]).toBe('| implement | 50.0 | 2 | 25.0 |')
		expect(rows).toHaveLength(6)
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
	})

	it('reads an explicit threshold, keeping only the lane over it', async () => {
		const argv = ['stats', '--period', '1', '--sinks', '46']

		await expect(lane_measure_cli.run(argv, seeded_context())).resolves.toBe(0)

		expect(String(vi.mocked(console.info).mock.calls[0]?.[0])).toContain('| 1 |')
	})
})
