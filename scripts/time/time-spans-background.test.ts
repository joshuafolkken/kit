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

const { MINUTE_MS, assistant_text, tool_result, tool_result_body, tool_use } = time_line_fixture

const PNPM_LABEL = 'Bash: pnpm'
const GATE_COMMAND = 'josh gate'
const BACKGROUND_ID = 'b3sods4bd'
const OUTPUT_PATH = `/tmp/claude/tasks/${BACKGROUND_ID}.output`
const LAUNCH_BODY = `Command running in background with ID: ${BACKGROUND_ID}. Output is being written to: ${OUTPUT_PATH}`

// The gate launched at minute 1, a review beside it, and the output read back at minute 9.
const BACKGROUNDED = [
	assistant_text(0),
	tool_use(1, 'Bash', 'launch', { command: 'pnpm josh gate', run_in_background: true }),
	tool_result_body(2, 'launch', LAUNCH_BODY),
	tool_use(3, 'Skill', 'review', {}),
	tool_result(8, 'review'),
	tool_use(8, 'Bash', 'join', { command: `tail -25 ${OUTPUT_PATH}` }),
	tool_result(9, 'join'),
].join('\n')

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

	// The whole placement rests on two fields read off lines a span discards, so a case that only
	// asserted the result would pass on a reading that recovered neither.
	it('carries the launch id and the id the joining call reads', () => {
		const { spans } = time_spans.parse_timeline(BACKGROUNDED)

		expect(span_of(BACKGROUNDED, PNPM_LABEL)?.background_id).toBe(BACKGROUND_ID)
		expect(spans.at(-1)?.reads_background).toBe(BACKGROUND_ID)
	})
})
