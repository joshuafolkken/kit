import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { assert, describe, expect, it } from 'vitest'
import { lane_elapsed_time } from './lane-elapsed-time'
import type { LedgerEntry } from './lane-ledger'
import { lane_net_time } from './lane-net-time'
import type { ToolCall } from './lane-transcript-calls'

const ISSUE = 7356
const START = Date.parse('2026-11-12T05:00:00Z')
const MINUTE = 60_000

function at(minute: number): string {
	return new Date(START + minute * MINUTE).toISOString()
}

function event(minute: number, kind: string, words: string): RunEvent {
	return { pos: minute, at: at(minute), kind, text: `#7356 ${words}` }
}

function call(start: number, minutes: number): ToolCall {
	return {
		session_id: 'fixture',
		lane: '7356',
		started_ms: START + start * MINUTE,
		duration_ms: minutes * MINUTE,
		tool: 'Bash',
		background: false,
		command: 'pnpm josh gate',
		subagent: undefined,
		output: '',
	}
}

function entries(merge = 40): Array<LedgerEntry> {
	return [
		{ kind: 'dispatch', issue: ISSUE, at: at(0) },
		{ kind: 'dispatch', issue: ISSUE, at: at(25) },
		{ kind: 'stage', issue: ISSUE, at: at(35), stage: 'followup', elapsed_ms: 5 * MINUTE },
		{ kind: 'merge', issue: ISSUE, at: at(merge) },
	]
}

function total(parts: ReturnType<typeof lane_elapsed_time.of>): number | undefined {
	return parts === undefined
		? undefined
		: parts.work_ms + parts.automatic_ms + parts.human_ms + parts.unclassified_ms
}

describe('lane_elapsed_time — exclusive end-to-end accounting (#7379)', () => {
	it('includes yield, followup and human wait in the 30-minute decision', () => {
		const events = [event(5, 'park', 'parked on a decision'), event(15, 'note', 'yield to #7333')]
		const parts = lane_elapsed_time.of(entries(), events, ISSUE, [call(0, 10), call(3, 9)])

		assert(parts)

		expect(parts.total_ms).toBe(40 * MINUTE)
		expect(parts.within_target).toBe(false)
		expect(parts.human_ms).toBe(20 * MINUTE)
		expect(total(parts)).toBe(parts.total_ms)
		expect(parts.tool_ms).toBe(19 * MINUTE)
	})
	it('unions parallel calls instead of summing them into wall clock', () => {
		const parts = lane_elapsed_time.of(entries(), [], ISSUE, [call(0, 10), call(3, 9)])

		expect(parts?.automatic_ms).toBe(17 * MINUTE)
		expect(parts?.work_ms).toBe(23 * MINUTE)
		expect(parts?.tool_ms).toBe(19 * MINUTE)
		expect(total(parts)).toBe(40 * MINUTE)
	})
	it('does not describe absent transcript coverage as measured work', () => {
		const parts = lane_elapsed_time.of(entries(), [], ISSUE, [])

		expect(parts?.work_ms).toBe(0)
		expect(parts?.unclassified_ms).toBe(35 * MINUTE)
		expect(total(parts)).toBe(40 * MINUTE)
		expect(parts && lane_elapsed_time.text(parts)).toContain('missing transcripts')
	})
})

describe('lane_elapsed_time — split evidence', () => {
	it('keeps pre-split work outside automatic wait while preserving legacy net', () => {
		const rows: ReadonlyArray<LedgerEntry> = [
			{ kind: 'dispatch', issue: ISSUE, at: at(0) },
			{ kind: 'dispatch', issue: ISSUE, at: at(20) },
			{ kind: 'merge', issue: ISSUE, at: at(30) },
		]
		const events = [event(10, 'split', 'split into children')]
		const parts = lane_elapsed_time.of(rows, events, ISSUE, [call(0, 5)])

		expect(parts?.automatic_ms).toBe(5 * MINUTE)
		expect(parts?.work_ms).toBe(25 * MINUTE)
		expect(total(parts)).toBe(30 * MINUTE)
		expect(lane_net_time.net_ms(rows, events, ISSUE)).toBe(10 * MINUTE)
	})
})

describe('lane_elapsed_time — bounds and retry evidence', () => {
	it('clips calls to the dispatch/merge boundaries and keeps the target inclusive', () => {
		const parts = lane_elapsed_time.of(entries(30), [], ISSUE, [call(-5, 10), call(28, 10)])

		expect(parts?.automatic_ms).toBe(7 * MINUTE)
		expect(parts?.within_target).toBe(true)
		expect(parts?.tool_ms).toBe(7 * MINUTE)
	})
	it('reports CI retry intervals once and keeps the fix between them outside automatic wait', () => {
		const rows: ReadonlyArray<LedgerEntry> = [
			...entries(),
			{ kind: 'stage', issue: ISSUE, at: at(10), stage: 'followup', elapsed_ms: 5 * MINUTE },
			{
				kind: 'stop',
				issue: ISSUE,
				at: at(10),
				reason: 'followup',
				cause: 'check',
				checks: ['SonarQube'],
			},
			{
				kind: 'stage',
				issue: ISSUE,
				at: at(10),
				stage: 'ci-wait',
				elapsed_ms: 4 * MINUTE,
				has_rerun: true,
			},
		]
		const parts = lane_elapsed_time.of(rows, [], ISSUE, [call(20, 1)])

		expect(parts?.automatic_ms).toBe(11 * MINUTE)
		expect(total(parts)).toBe(40 * MINUTE)
	})
})

it('refuses missing merge evidence', () => {
	expect(lane_elapsed_time.of([], [], ISSUE, [])).toBeUndefined()
})
