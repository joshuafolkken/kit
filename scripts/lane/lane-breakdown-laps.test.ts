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

	it("leaves out another lane's laps and a lap ended between ship stages", () => {
		expect(minutes_of([lap(JOSH_GATE, 3, 15, OTHER_ISSUE), lap('push', 1, 18)])).toStrictEqual([])
	})
})

describe('lane_breakdown_laps.of — between ship stages', () => {
	it('splits the time between ship stages by the Bash the child ran there', () => {
		const calls = [bash(17, 2, GATE_COMMAND), bash(12, 1, GATE_COMMAND)]

		expect(minutes_of([], calls)).toStrictEqual([[BETWEEN, [['gate', 2]]]])
	})
})
