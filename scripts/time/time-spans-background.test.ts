import { describe, expect, it } from 'vitest'
import { time_line_fixture } from './time-line-fixture'
import { time_spans, type Span } from './time-spans'

// A command the harness took into the background, read end to end from a transcript
// (joshuafolkken/kit#1662).
//
// The partition names a span by the event that closes it, so a `pnpm josh gate` issued with
// `run_in_background` closed at its own launch call two or three seconds later — and `gate` counted
// those seconds while the minutes it actually ran belonged to whatever came next. The two halves that
// place it are both read here, at parse time, because a span keeps neither an input nor a body.
//
// It sits beside `time-spans.test.ts` rather than inside it because that file reached its length
// limit — the seam `time-spans-turns.test.ts` was already cut along. The line builders are shared
// rather than copied: `time-line-fixture.ts` holds the one set both suites write their transcripts
// from.

const {
	MINUTE_MS,
	at,
	assistant_text,
	attached_notification,
	queued_notification,
	task_notification,
	tool_result,
	tool_result_body,
	tool_use,
} = time_line_fixture

const PNPM_LABEL = 'Bash: pnpm'
const GATE_COMMAND = 'josh gate'
const BACKGROUND_ID = 'b3sods4bd'
const OUTPUT_PATH = `/tmp/claude/tasks/${BACKGROUND_ID}.output`
const LAUNCH_BODY = `Command running in background with ID: ${BACKGROUND_ID}. Output is being written to: ${OUTPUT_PATH}`

// The opening all three cases share: the gate issued in the background at minute 1, and the launch
// result that announces the id at minute 2.
const LAUNCHED = [
	assistant_text(0),
	tool_use(1, 'Bash', 'launch', { command: 'pnpm josh gate', run_in_background: true }),
	tool_result_body(2, 'launch', LAUNCH_BODY),
]

// A `BashOutput` look at the gate while it is still running, which is the tool a run polls with.
const POLL = [tool_use(4, 'BashOutput', 'poll', { bash_id: BACKGROUND_ID }), tool_result(5, 'poll')]

// The `tail` of the output file made after the harness said the command had ended.
const JOIN = [
	tool_use(8, 'Bash', 'join', { command: `tail -25 ${OUTPUT_PATH}` }),
	tool_result(9, 'join'),
]

// The gate launched at minute 1, a review beside it, the harness's end-of-task notice at minute 8 and
// the output read back at minute 9.
const BACKGROUNDED = [
	...LAUNCHED,
	tool_use(3, 'Skill', 'review', {}),
	tool_result(8, 'review'),
	task_notification(8, BACKGROUND_ID),
	...JOIN,
].join('\n')

// The same gate, polled at minute 4 while it was still running (joshuafolkken/kit#1696). Before the
// notice was read, that poll closed the window — so the gate reported the three minutes to the poll,
// and reported them as measured.
const POLLED = [...LAUNCHED, ...POLL, task_notification(8, BACKGROUND_ID), ...JOIN].join('\n')

// The same run again, with nothing read after the notice — so nothing in the transcript says how long
// the gate ran, and the launch keeps the seconds its own call took.
const POLLED_ONLY = [...LAUNCHED, ...POLL, task_notification(8, BACKGROUND_ID)].join('\n')

// The same run once more, with the notice on the carrier most sessions actually hold: the
// `queue-operation` line the harness writes when the notice is generated, which carries no `message`
// at all. Measured against the conversational carrier alone, this run came back unmeasured.
const QUEUED = [...LAUNCHED, ...POLL, queued_notification(8, BACKGROUND_ID), ...JOIN].join('\n')

// A run that backgrounded nothing, which is most sessions and every case in the suite next door.
const PLAIN = [assistant_text(0), tool_use(1, 'Read', 'read-1'), tool_result(2, 'read-1')].join(
	'\n',
)

function span_of(text: string, label: string): Span | undefined {
	return time_spans.parse_timeline(text).spans.find((span) => span.label === label)
}

describe('time_spans.parse_timeline — a command taken into the background', () => {
	// The measurement the issue asks for: `own_duration_ms` is what a per-invocation row is asked for,
	// and for a backgrounded call what it took is launch to the point its result was read.
	it('gives the launch the length of the command it started', () => {
		expect(span_of(BACKGROUNDED, PNPM_LABEL)?.own_duration_ms).toBe(8 * MINUTE_MS)
	})

	// The share of the wall clock is what the phase totals are summed from, so it has to stay the
	// interval the span really occupied or the shares stop reconstructing the elapsed time.
	it('leaves the launch its own share of the wall clock', () => {
		expect(span_of(BACKGROUNDED, PNPM_LABEL)?.duration_ms).toBe(MINUTE_MS)
	})

	it('stamps the spans inside the window with the command they ran beside', () => {
		const { spans } = time_spans.parse_timeline(BACKGROUNDED)

		expect(span_of(BACKGROUNDED, 'Skill')?.background_command).toBe(GATE_COMMAND)
		expect(spans.at(-1)?.background_command).toBe(GATE_COMMAND)
	})

	it('stamps nothing on a run that backgrounded nothing', () => {
		const { spans } = time_spans.parse_timeline(PLAIN)

		expect(spans.every((span) => span.background_command === '')).toBe(true)
	})

	// The whole placement rests on three fields read off lines a span discards, so a case that only
	// asserted the result would pass on a reading that recovered none of them.
	it('carries the launch id, the id the joining call reads, and the instant it ended', () => {
		const { spans } = time_spans.parse_timeline(BACKGROUNDED)
		const launch = span_of(BACKGROUNDED, PNPM_LABEL)

		expect([launch?.background_id, launch?.background_ended_ms]).toEqual([
			BACKGROUND_ID,
			Date.parse(at(8)),
		])
		expect(spans.at(-1)?.reads_background).toBe(BACKGROUND_ID)
	})
})

describe('time_spans.parse_timeline — a backgrounded command polled while it ran', () => {
	// joshuafolkken/kit#1696: the poll is a reading of the output, but not one that saw the command
	// end, so the window runs on to the call made after the harness said it had.
	it('measures the whole run rather than the minutes to the poll', () => {
		expect(span_of(POLLED, PNPM_LABEL)?.own_duration_ms).toBe(8 * MINUTE_MS)
	})

	// The confident number is the half that made this worse than the gap it replaced: `is_read` said
	// the runtime had been measured, so the row carried no note saying it had not.
	it('says nothing was measured where the poll was the only reading', () => {
		expect(span_of(POLLED_ONLY, PNPM_LABEL)?.own_duration_ms).toBe(MINUTE_MS)
	})

	// Which line kind a session holds the notice on varies, so a reading that knew only the
	// conversational one reported most real runs as never measured.
	it('reads the notice off the queue line a session holds it on instead', () => {
		expect(span_of(QUEUED, PNPM_LABEL)?.own_duration_ms).toBe(8 * MINUTE_MS)
	})

	// The three carriers are one notice at three moments — generated, delivered, consumed — so the
	// earliest is when the task ended and the later ones are when something got round to it.
	it('pairs the launch with the earliest of the carriers, not the last', () => {
		const carried = [
			...LAUNCHED,
			queued_notification(6, BACKGROUND_ID),
			attached_notification(7, BACKGROUND_ID),
			task_notification(8, BACKGROUND_ID),
			...JOIN,
		].join('\n')

		expect(span_of(carried, PNPM_LABEL)?.background_ended_ms).toBe(Date.parse(at(6)))
	})
})
