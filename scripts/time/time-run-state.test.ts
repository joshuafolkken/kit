import type { CarryRead, RunCarry } from '#scripts/run/run-carry'
import type { RunWake } from '#scripts/run/run-wake'
import { time_spans, type Span } from '#scripts/time-runtime/time-spans'
import { describe, expect, it } from 'vitest'
import { time_run_state, type RunStateInput, type WhiffSession } from './time-run-state'
import { time_transcript_fixture } from './time-transcript-fixture'

const { span } = time_transcript_fixture
const NOW_MS = time_run_state.SILENT_WINDOW_MS * 2
const IDLE_ACTIVITY_MS = 0
const RECENT_ACTIVITY_MS = NOW_MS
const MERGE_COMMAND = 'josh followup'
const STARTED_AT = '2026-09-13T10:00:00.000Z'
const HELD_AT = '2026-09-13T10:08:00.000Z'
const WHIFF_1 = '2026-09-13T10:18:00.000Z'
const WHIFF_2 = '2026-09-13T10:28:00.000Z'
const WHIFF_3 = '2026-09-13T10:38:00.000Z'
const THREE_WHIFFS: ReadonlyArray<WhiffSession> = [
	{ at: WHIFF_1, cost_usd: 0.3 },
	{ at: WHIFF_2, cost_usd: 0.3 },
	{ at: WHIFF_3, cost_usd: 0.3 },
]

function carry(overrides: Partial<RunCarry> = {}): RunCarry {
	return {
		invocation: 'backlogrun',
		started_at: STARTED_AT,
		merged: 0,
		filed: 0,
		cuts: 1,
		...overrides,
	}
}

function carried(overrides: Partial<RunCarry> = {}): CarryRead {
	return { kind: 'carried', carry: carry(overrides) }
}

function input(overrides: Partial<RunStateInput> = {}): RunStateInput {
	return {
		carry: carried(),
		is_owner_live: false,
		wake: undefined,
		now_ms: NOW_MS,
		last_activity_ms: IDLE_ACTIVITY_MS,
		whiffs: [],
		...overrides,
	}
}

function model_span(): Span {
	return { ...span('go', 1, 1), category: time_spans.MODEL_CATEGORY }
}

describe('time_run_state.classify status', () => {
	it('reads a cut with no successor: handed off, owner gone', () => {
		const facts = time_run_state.classify(input({ carry: carried({ is_handed_off: true }) }))

		expect(facts.status).toBe(time_run_state.CUT_NO_SUCCESSOR)
		expect(facts.is_measured).toBe(true)
		expect(facts.is_ended).toBe(false)
	})

	it('reads a healthy hand-off: handed off, a live successor', () => {
		const facts = time_run_state.classify(
			input({ carry: carried({ is_handed_off: true }), is_owner_live: true }),
		)

		expect(facts.status).toBe(time_run_state.HANDED_OFF)
	})

	it('reads a live owner sitting idle as stalled, not running', () => {
		expect(time_run_state.classify(input({ is_owner_live: true })).status).toBe(
			time_run_state.OWNER_STALLED,
		)
	})

	it('reads a live owner with recent activity as running', () => {
		const facts = time_run_state.classify(
			input({ is_owner_live: true, last_activity_ms: RECENT_ACTIVITY_MS }),
		)

		expect(facts.status).toBe(time_run_state.RUNNING)
	})

	it('reads an owner gone with no hand-off as owner_gone', () => {
		expect(time_run_state.classify(input()).status).toBe(time_run_state.OWNER_GONE)
	})

	it('reads an expired record as abandoned and ended', () => {
		const facts = time_run_state.classify(input({ carry: { kind: 'expired', carry: carry() } }))

		expect(facts.status).toBe(time_run_state.EXPIRED)
		expect(facts.is_ended).toBe(true)
	})
})

describe('time_run_state.classify measurement', () => {
	it('reports no record as not measured and ended, never as running', () => {
		const facts = time_run_state.classify(input({ carry: { kind: 'none' } }))

		expect(facts.status).toBe(time_run_state.NOT_MEASURED)
		expect(facts.is_measured).toBe(false)
		expect(facts.is_ended).toBe(true)
	})

	it('reports an unreadable record as not measured but not ended', () => {
		const facts = time_run_state.classify(input({ carry: { kind: 'unreadable' } }))

		expect(facts.is_measured).toBe(false)
		expect(facts.is_ended).toBe(false)
	})

	it('takes the last cut from the wake record when it carries one', () => {
		const wake: RunWake = {
			invocation: 'backlogrun',
			started_at: STARTED_AT,
			pid: 1,
			woke: 1,
			held_at: HELD_AT,
		}

		expect(time_run_state.classify(input({ wake })).last_cut_at).toBe(HELD_AT)
	})
})

describe('time_run_state.is_whiff', () => {
	it('is a whiff when a session called tools but edited, committed and merged nothing', () => {
		expect(time_run_state.is_whiff([span('Bash', 1, 1)])).toBe(true)
	})

	it('is not a whiff when the session made an edit', () => {
		expect(time_run_state.is_whiff([span('Write', 1, 1)])).toBe(false)
	})

	it('is not a whiff when the session ran a merging command', () => {
		const merging: Span = { ...span('Bash', 1, 1), josh_commands: [MERGE_COMMAND] }

		expect(time_run_state.is_whiff([merging])).toBe(false)
	})

	it('is not a whiff when the merging command runs as a chained, non-first segment', () => {
		const chained: Span = { ...span('Bash', 1, 1), josh_commands: ['git push', MERGE_COMMAND] }

		expect(time_run_state.is_whiff([chained])).toBe(false)
	})

	it('is not a whiff when the session made no tool call at all', () => {
		expect(time_run_state.is_whiff([model_span()])).toBe(false)
	})
})

describe('time_run_state whiff pricing and rendering', () => {
	it('tallies the whiff count, dollars and times', () => {
		const facts = time_run_state.classify(input({ whiffs: THREE_WHIFFS.slice(0, 2) }))

		expect(facts.whiffs.count).toBe(2)
		expect(facts.whiffs.cost_usd).toBeCloseTo(0.6)
		expect(facts.whiffs.at).toHaveLength(2)
	})

	it('renders three whiffs with their total dollars', () => {
		const facts = time_run_state.classify(
			input({ carry: carried({ is_handed_off: true }), whiffs: THREE_WHIFFS }),
		)
		const text = time_run_state.run_state_lines(facts).join('\n')

		expect(text).toContain('whiff wake sessions: 3')
		expect(text).toContain('$0.90')
		expect(text).toContain('cut, but no successor took over')
	})

	it('renders no record as "not measured", never as not stopped', () => {
		const facts = time_run_state.classify(input({ carry: { kind: 'none' } }))
		const text = time_run_state.run_state_lines(facts).join('\n')

		expect(text).toContain('not measured')
		expect(text).not.toContain('run ended')
	})
})

describe('time_run_state.is_unfinished', () => {
	it('is unfinished while a record is still here to read', () => {
		const facts = time_run_state.classify(input())

		expect(time_run_state.is_unfinished(facts)).toBe(true)
	})

	it('is finished once the record is gone', () => {
		const facts = time_run_state.classify(input({ carry: { kind: 'none' } }))

		expect(time_run_state.is_unfinished(facts)).toBe(false)
	})

	it('renders nothing for an absent report', () => {
		expect(time_run_state.run_state_lines(undefined)).toEqual([])
	})
})

describe('time_run_state.lead_lines', () => {
	it('leads with the run-state block while the run is unfinished', () => {
		const facts = time_run_state.classify(input({ carry: carried({ is_handed_off: true }) }))

		expect(time_run_state.lead_lines(facts)[0]).toBe(time_run_state.HEADING)
	})

	it('leads with nothing once the run has finished', () => {
		const facts = time_run_state.classify(input({ carry: { kind: 'none' } }))

		expect(time_run_state.lead_lines(facts)).toEqual([])
	})
})
