import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { assert, describe, expect, it } from 'vitest'
import { lane_breakdown } from './lane-breakdown'
import { lane_elapsed_time } from './lane-elapsed-time'
import type { LedgerEntry } from './lane-ledger'
import { lane_net_time } from './lane-net-time'
import type { ToolCall } from './lane-transcript-calls'

// Saved records from the common ledger and compacted stream on 2026-11-12. Timestamps/durations
// are the recorded values, not rounded minutes. Only intervals needed for each regression are kept.
const SAMPLES = [
	{
		issue: 7333,
		start: '2026-11-12T03:28:36.399Z',
		end: '2026-11-12T05:21:30.048Z',
		plan: '2026-11-12T03:52:44.339Z',
		followups: [
			{ at: '2026-11-12T05:06:52.159Z', elapsed_ms: 1_615_290.605584 },
			{ at: '2026-11-12T05:21:22.302Z', elapsed_ms: 241_456.96816699998 },
		],
	},
	{
		issue: 7354,
		start: '2026-11-12T05:16:41.773Z',
		end: '2026-11-12T06:14:20.229Z',
		plan: '2026-11-12T05:19:46.851Z',
		followups: [{ at: '2026-11-12T06:14:09.769Z', elapsed_ms: 317_116.60170799994 }],
	},
	{
		issue: 7356,
		start: '2026-11-12T05:23:29.094Z',
		end: '2026-11-12T06:22:41.419Z',
		plan: '2026-11-12T05:26:19.967Z',
		followups: [{ at: '2026-11-12T06:22:33.489Z', elapsed_ms: 332_886.458583 }],
	},
] as const

type Sample = (typeof SAMPLES)[number]

function entries(sample: Sample): Array<LedgerEntry> {
	return [
		{ kind: 'dispatch', issue: sample.issue, at: sample.start },
		...sample.followups.map((row) => ({
			...row,
			kind: 'stage' as const,
			stage: 'followup',
			issue: sample.issue,
		})),
		{ kind: 'merge', issue: sample.issue, at: sample.end },
	]
}

function events(sample: Sample): Array<RunEvent> {
	return [
		{ kind: 'lane-phase', pos: 1, at: sample.plan, text: `#${String(sample.issue)} implement` },
		{ kind: 'ship-stage', pos: 2, at: sample.end, text: `#${String(sample.issue)} report done` },
	]
}

describe('saved lane evidence — compacted ship stages (#7379)', () => {
	it.each(SAMPLES)(
		'recovers driver followup for #$issue without counting it as implementation',
		(sample) => {
			const rows = entries(sample)
			const stream = events(sample)
			const breakdown = lane_breakdown.of(rows, stream, sample.issue)

			assert(breakdown)
			const driver_ms = sample.followups.reduce((sum, row) => sum + Math.ceil(row.elapsed_ms), 0)
			const net_ms = lane_net_time.net_ms(rows, stream, sample.issue)

			expect(breakdown.driver).toEqual([{ name: 'driver followup', ms: driver_ms }])
			expect(net_ms).toBe(Date.parse(sample.end) - Date.parse(sample.start) - driver_ms)
		},
	)
})

function saved_call(started_ms: number, duration_ms: number): ToolCall {
	return {
		started_ms,
		duration_ms,
		session_id: 'saved-7356',
		lane: '7356',
		tool: 'Agent',
		background: false,
		command: undefined,
		subagent: undefined,
		output: '',
	}
}

it('keeps #7356 parallel call cumulative time separate from its yield wall clock', () => {
	const sample = SAMPLES.at(2)

	assert(sample)
	const rows: ReadonlyArray<LedgerEntry> = [
		...entries(sample),
		{ kind: 'dispatch', issue: 7356, at: '2026-11-12T06:02:52.473Z' },
	]
	const stream: ReadonlyArray<RunEvent> = [
		...events(sample),
		{
			kind: 'note',
			pos: 3,
			at: '2026-11-12T05:37:42.322Z',
			text: '#7356 yielded its lane: holder #7355',
		},
	]
	const calls = [saved_call(1_794_463_059_275, 97_009), saved_call(1_794_463_061_025, 102_120)]
	const timing = lane_elapsed_time.of(rows, stream, 7356, calls)

	assert(timing)

	expect(timing.tool_ms).toBe(199_129)
	expect(timing.automatic_ms).toBe(1_510_151 + 332_887)
	expect(timing.work_ms + timing.automatic_ms).toBe(timing.total_ms)
})
