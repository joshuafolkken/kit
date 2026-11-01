import { describe, expect, it } from 'vitest'
import type { Breakdown } from './lane-breakdown'
import { lane_breakdown_laps } from './lane-breakdown-laps'
import type { LedgerEntry } from './lane-ledger'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#5294: a ship stage of the breakdown splits into the laps the ship wrote inside it
// and the core-budget waits that ended there; the time between ship stages by the child's Bash.

const MINUTE_MS = 60_000
const ISSUE = 5294
const OTHER_ISSUE = 5295
const SHIP_GATE = 'ship gate'
const BETWEEN = 'between ship stages'
const JOSH_GATE = 'josh gate'
const SCOPED_PAIR = 'scoped pair'
const GATE_COMMAND = 'pnpm josh gate'
const EDITING = 'editing & thinking'

const BREAKDOWN: Breakdown = {
	stages: [],
	excluded_ms: 0,
	slept_ms: 0,
	yield_ms: 0,
	waits: [],
	implement: [],
	pre_detach: [],
	ship: [
		{ stage: SHIP_GATE, from_ms: 10 * MINUTE_MS, to_ms: 16 * MINUTE_MS },
		{ stage: BETWEEN, from_ms: 16 * MINUTE_MS, to_ms: 20 * MINUTE_MS },
		{ stage: 'ship commit', from_ms: 20 * MINUTE_MS, to_ms: 22 * MINUTE_MS },
	],
}

function at(minute: number): string {
	return new Date(minute * MINUTE_MS).toISOString()
}

function lap(step: string, minutes: number, ended: number, issue = ISSUE): LedgerEntry {
	return {
		kind: 'ship-lap',
		at: at(ended),
		issue,
		stage: 'gate',
		step,
		elapsed_ms: minutes * MINUTE_MS,
	}
}

function core_wait(minutes: number, ended: number): LedgerEntry {
	return {
		kind: 'core-wait',
		at: at(ended),
		command: 'gate',
		waited_ms: minutes * MINUTE_MS,
		issue: ISSUE,
	}
}

// A gate row ended at `ended`, its checks `[label, minutes]` — a zero-minute one reused, as the gate
// writes it; no `issue` as on a row written outside a lane or before the gate recorded it.
function gate(
	checks: ReadonlyArray<readonly [string, number]>,
	ended: number,
	issue?: number,
): LedgerEntry {
	return {
		kind: 'gate',
		at: at(ended),
		elapsed_ms: 0,
		is_passed: true,
		checks: checks.map(([label, minutes]) => ({
			label,
			elapsed_ms: minutes * MINUTE_MS,
			is_passed: true,
			is_reused: minutes === 0,
		})),
		...(issue !== undefined && { issue }),
	}
}

function bash(minute: number, minutes: number, command: string): ToolCall {
	return {
		session_id: 's',
		lane: String(ISSUE),
		started_ms: minute * MINUTE_MS,
		duration_ms: minutes * MINUTE_MS,
		tool: 'Bash',
		background: false,
		command,
		subagent: undefined,
		output: '',
	}
}

function minutes_of(
	entries: ReadonlyArray<LedgerEntry>,
	calls: ReadonlyArray<ToolCall> = [],
): Array<[string, Array<readonly [string, number]>]> {
	const laps = lane_breakdown_laps.of(entries, ISSUE, BREAKDOWN, calls)

	return [...laps].map(([stage, parts]) => [
		stage,
		parts.map((part) => [part.name, part.ms / MINUTE_MS] as const),
	])
}

describe('lane_breakdown_laps.of — ship stages', () => {
	it('groups the laps under the ship stage they ended in, longest first', () => {
		const entries = [lap(SCOPED_PAIR, 1, 12), lap(JOSH_GATE, 3, 15)]

		expect(minutes_of(entries)).toStrictEqual([
			[
				SHIP_GATE,
				[
					[JOSH_GATE, 3],
					[SCOPED_PAIR, 1],
				],
			],
		])
	})

	it("places the lane's core-budget wait beside the laps of its stage", () => {
		expect(minutes_of([lap(JOSH_GATE, 3, 15), core_wait(2, 14)])).toStrictEqual([
			[
				SHIP_GATE,
				[
					[JOSH_GATE, 3],
					[lane_breakdown_laps.CORE_WAIT_STEP, 2],
				],
			],
		])
	})

	// joshuafolkken/kit#5531: a minutes-long pair tells why it read the whole branch.
	it('names why a lap read the whole branch', () => {
		const entries = [{ ...lap(SCOPED_PAIR, 4, 12), fallback: 'no-record, hub' }]

		expect(minutes_of(entries)).toStrictEqual([
			[SHIP_GATE, [[`${SCOPED_PAIR} (whole branch: no-record, hub)`, 4]]],
		])
	})

	it("leaves out another lane's laps and a lap ended between ship stages", () => {
		const entries = [lap(JOSH_GATE, 3, 15, OTHER_ISSUE), lap('push', 1, 18)]

		expect(minutes_of(entries)).toStrictEqual([])
	})
})

// joshuafolkken/kit#5567: a gate the ship reused is counted on one row, apart from a gate that ran.
describe('lane_breakdown_laps.of — a reused josh gate', () => {
	it('counts the stage reuses on one row beside the gate that ran', () => {
		const entries = [
			{ ...lap(JOSH_GATE, 0, 12), reused_tree: 'abc' },
			{ ...lap(JOSH_GATE, 0, 13), reused_tree: 'def' },
			{ ...lap(JOSH_GATE, 2, 14), rerun: 'merge' },
		]

		expect(minutes_of(entries)).toStrictEqual([
			[
				SHIP_GATE,
				[
					[`${JOSH_GATE} (merge)`, 2],
					[`${JOSH_GATE} (reused ×2)`, 0],
				],
			],
		])
	})
})

// joshuafolkken/kit#5538: a scoped pair that ran again says which run it was and why.
describe('lane_breakdown_laps.of — a scoped pair run again', () => {
	it('names the run count and the rerun reason beside why it read the whole branch', () => {
		const entries = [
			{ ...lap(SCOPED_PAIR, 4, 12), runs: 2, rerun: 'moved', fallback: 'hub' },
			{ ...lap(SCOPED_PAIR, 3, 14), runs: 1 },
		]

		expect(minutes_of(entries)).toStrictEqual([
			[
				SHIP_GATE,
				[
					[`${SCOPED_PAIR} (run 2: moved; whole branch: hub)`, 4],
					[SCOPED_PAIR, 3],
				],
			],
		])
	})
})

// joshuafolkken/kit#5319: the gate's own checks sit under the ship gate beside its laps.
describe('lane_breakdown_laps.of — the checks of the gate', () => {
	it("puts each check of the lane's gate under the ship stage it ended in, longest first", () => {
		const entries = [
			lap(JOSH_GATE, 3, 15),
			gate(
				[
					['cspell', 0.5],
					['unit', 2],
					['lint', 1],
				],
				15,
				ISSUE,
			),
		]

		expect(minutes_of(entries)).toStrictEqual([
			[
				SHIP_GATE,
				[
					[JOSH_GATE, 3],
					['unit', 2],
					['lint', 1],
					['cspell', 0.5],
				],
			],
		])
	})
})

describe('lane_breakdown_laps.of — the checks it leaves out', () => {
	it('leaves out a check the gate reused, which spent no time', () => {
		const entries = [
			gate(
				[
					['lint', 0],
					['unit', 2],
				],
				15,
				ISSUE,
			),
		]

		expect(minutes_of(entries)).toStrictEqual([[SHIP_GATE, [['unit', 2]]]])
	})

	it("leaves out another lane's gate and a gate row with no issue", () => {
		const entries = [gate([['unit', 2]], 15, OTHER_ISSUE), gate([['lint', 1]], 15)]

		expect(minutes_of(entries)).toStrictEqual([])
	})
})

describe('lane_breakdown_laps.of — between ship stages', () => {
	it('splits the time between ship stages by the Bash the child ran there', () => {
		const calls = [bash(17, 2, GATE_COMMAND), bash(12, 1, GATE_COMMAND)]

		expect(minutes_of([], calls)).toStrictEqual([
			[
				BETWEEN,
				[
					['gate', 2],
					[EDITING, 2],
				],
			],
		])
	})

	// joshuafolkken/kit#5646: a lane that never paused reads as before.
	it('splits it by the Bash alone when the lane recorded no park', () => {
		const breakdown = { ...BREAKDOWN, pauses: [] }
		const laps = lane_breakdown_laps.of([], ISSUE, breakdown, [bash(17, 2, GATE_COMMAND)])

		expect([...laps]).toStrictEqual([
			[
				BETWEEN,
				[
					{ name: 'gate', ms: 2 * MINUTE_MS },
					{ name: EDITING, ms: 2 * MINUTE_MS },
				],
			],
		])
	})
})

// joshuafolkken/kit#5755: what no Bash call covered between two ship stages is the child's own time.
describe('lane_breakdown_laps.of — the rest between ship stages', () => {
	it('names the time no Bash call covered editing and thinking, a wait taken out', () => {
		const breakdown = { ...BREAKDOWN, waits: [{ from_ms: 19 * MINUTE_MS, to_ms: 20 * MINUTE_MS }] }
		const laps = lane_breakdown_laps.of([], ISSUE, breakdown, [bash(16, 1, GATE_COMMAND)])

		expect(laps.get(BETWEEN)).toStrictEqual([
			{ name: EDITING, ms: 2 * MINUTE_MS },
			{ name: 'gate', ms: MINUTE_MS },
		])
	})

	it('adds no row when the Bash covered all of it', () => {
		expect(minutes_of([], [bash(16, 4, GATE_COMMAND)])).toStrictEqual([[BETWEEN, [['gate', 4]]]])
	})

	// A reader with no transcript calls (`lane-sinks.ts`) does not know the time was editing.
	it('leaves the time unsplit when no calls were read', () => {
		expect(minutes_of([], [])).toStrictEqual([])
	})
})
