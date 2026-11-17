import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_timeline_steps } from './lane-timeline-steps'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#7737: the steps inside a lane's stages — read off the ledger, which a ship's
// foreground writes whatever its caller does with the output, and off the transcripts for what the
// ledger does not time — and the ship's stages numbered by attempt.

const ISSUE = 7695
const OTHER_ISSUE = 7700
const MINUTE_MS = 60_000
const START = Date.parse('2026-11-17T05:00:00.000Z')
const PREFLIGHT = 'preflight'
const PRE_DETACH = 'pre-detach'
const SYNC = 'sync'
const SHIP_SYNC = `ship ${SYNC}`
const RELATED = 'related'

function at(minute: number): string {
	return new Date(START + minute * MINUTE_MS).toISOString()
}

// A timed entry of `minutes` that ended at `minute`.
function ended(minute: number, minutes: number): { at: string; elapsed_ms: number } {
	return { at: at(minute), elapsed_ms: minutes * MINUTE_MS }
}

function lap(minute: number, ship_stage: string, step: string, issue = ISSUE): LedgerEntry {
	return { kind: 'ship-lap', ...ended(minute, 1), issue, stage: ship_stage, step }
}

function stage_line(minute: number, name: string): LedgerEntry {
	return { kind: 'stage', ...ended(minute, 1), stage: name, issue: ISSUE }
}

function step_names(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	return lane_timeline_steps.of(entries, [], ISSUE).map((step) => step.name)
}

function test_related(minute: number, minutes: number, scope: string): LedgerEntry {
	const counts = { changed: 1, synced: 0, since_map: 0, readers: 0 }

	return { kind: 'test-related', ...ended(minute, minutes), ...counts, issue: ISSUE, scope }
}

const CHECK_ENTRIES: ReadonlyArray<LedgerEntry> = [
	{ kind: 'chain', ...ended(1, 1), issue: ISSUE, join: true, stage: 'review:attest' },
	test_related(2, 1, RELATED),
	test_related(3, 0, 'none'),
	{ kind: 'test-pinned', ...ended(4, 1), held: 0, probes: [], issue: ISSUE },
	stage_line(5, 'ci-wait'),
]

const ROUND_ENTRIES: ReadonlyArray<LedgerEntry> = [
	{ kind: 'round-one', at: at(1), issue: ISSUE, verdict: 'reused' },
	{ kind: 'round-two', at: at(2), issue: ISSUE, verdict: 'required', code: 'live' },
]

describe('lane_timeline_steps.of — the ship laps', () => {
	it('reads a ship lap from its start, with its minutes', () => {
		expect(lane_timeline_steps.of([lap(10, SYNC, 'conflict probe')], [], ISSUE)).toStrictEqual([
			{ at_ms: START + 9 * MINUTE_MS, ms: MINUTE_MS, name: `${SHIP_SYNC} › conflict probe` },
		])
	})

	it('leaves out a nested lap and the main merge-in printed apart', () => {
		expect(
			step_names([lap(10, 'commit', 'josh git › push'), lap(11, SYNC, 'merge')]),
		).toStrictEqual([])
	})

	it("leaves out another lane's lines", () => {
		expect(step_names([lap(10, SYNC, 'push', OTHER_ISSUE)])).toStrictEqual([])
	})
})

describe('lane_timeline_steps.of — the checks, waits and rounds', () => {
	it('names each run:chain, test:related, test:pinned and CI wait', () => {
		expect(step_names(CHECK_ENTRIES)).toStrictEqual([
			'run:chain --join (review:attest)',
			`test:related (${RELATED})`,
			'test:pinned',
			'ci-wait',
		])
	})

	it('reads each review round as a point with its verdict', () => {
		const steps = lane_timeline_steps.of(ROUND_ENTRIES, [], ISSUE)

		expect(steps.map((step) => step.ms)).toStrictEqual([undefined, undefined])
		expect(steps.map((step) => step.name)).toStrictEqual([
			'review round 1 (reused)',
			'review round 2 (required)',
		])
	})
})

function call(command: string): ToolCall {
	return {
		session_id: 'session',
		lane: 'lane',
		started_ms: START,
		duration_ms: MINUTE_MS,
		tool: 'Bash',
		background: false,
		command,
		subagent: undefined,
		output: '',
	}
}

describe('lane_timeline_steps.of — the transcripts', () => {
	it('reads each lint:related, which the ledger does not time', () => {
		const calls = [call('pnpm josh lint:related'), call('pnpm josh test:related')]

		expect(lane_timeline_steps.of([], calls, ISSUE)).toStrictEqual([
			{ at_ms: START, ms: MINUTE_MS, name: 'lint:related' },
		])
	})
})

function stopped(minute: number): LedgerEntry {
	return { kind: 'stop', at: at(minute), issue: ISSUE, reason: PREFLIGHT }
}

const STOP = stopped(3)

describe('lane_timeline_steps.attempt_starts', () => {
	it('opens an attempt at each preflight a passed pre-detach did not run just before', () => {
		const entries = [
			stage_line(1, PREFLIGHT),
			stage_line(3, PRE_DETACH),
			STOP,
			stage_line(11, PREFLIGHT),
			stage_line(13, PRE_DETACH),
			stage_line(15, PREFLIGHT),
			stage_line(31, PREFLIGHT),
		]

		expect(lane_timeline_steps.attempt_starts(entries, ISSUE)).toStrictEqual(
			[0, 10, 30].map((minute) => START + minute * MINUTE_MS),
		)
	})

	it('opens an attempt at the pre-detach checks of a re-ship that passed over the preflight', () => {
		const entries = [
			stage_line(1, PREFLIGHT),
			stage_line(3, PRE_DETACH),
			stage_line(5, PREFLIGHT),
			stopped(6),
			stage_line(11, PRE_DETACH),
			stage_line(13, PREFLIGHT),
		]

		expect(lane_timeline_steps.attempt_starts(entries, ISSUE)).toStrictEqual(
			[0, 10].map((minute) => START + minute * MINUTE_MS),
		)
	})
})

describe('lane_timeline_steps.numbered', () => {
	const starts = [START, START + 10 * MINUTE_MS]

	it('names a ship line with its attempt', () => {
		expect(lane_timeline_steps.numbered(SHIP_SYNC, START + 11 * MINUTE_MS, starts)).toBe(
			'ship #2 sync',
		)
	})

	it('leaves a line before the first attempt or outside the ship as it is', () => {
		expect(lane_timeline_steps.numbered(SHIP_SYNC, START - MINUTE_MS * 2, starts)).toBe(SHIP_SYNC)
		expect(lane_timeline_steps.numbered('implement', START + MINUTE_MS, starts)).toBe('implement')
	})
})
