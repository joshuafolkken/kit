import { describe, expect, it } from 'vitest'
import { time_failures } from './time-failures'
import { time_reported_failure } from './time-reported-failure'
import { time_spans } from './time-spans'

// A red `josh gate` read through a pipe (joshuafolkken/kit#1361). The command is the one agents
// actually type, and the result is written back the way the harness writes it: `is_error: false`,
// because the pipeline exited with `tail`'s status, over a body that says the gate failed.

const MINUTE_MS = 60_000
const GATE_COMMAND = 'pnpm josh gate 2>&1 | tail -40'
const GATE_FAILED_BODY = [
	'',
	'✗ lint (pnpm josh lint) 4.2s',
	'✗ verification gate failed: lint',
].join('\n')
const GATE_PASSED_BODY = '\n✔ verification gate passed (4 checks) in 15.1s.'
const JOSH_GATE = 'josh gate'

function at(minute: number): string {
	return new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString()
}

function bash_call(minute: number, id: string, command: string): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: at(minute),
		message: { content: [{ type: 'tool_use', name: 'Bash', id, input: { command } }] },
	})
}

function bash_result(minute: number, id: string, content: unknown, is_error?: boolean): string {
	const result = { type: 'tool_result', tool_use_id: id, content }

	return JSON.stringify({
		type: 'user',
		timestamp: at(minute),
		message: { content: [is_error === undefined ? result : { ...result, is_error }] },
	})
}

function outcomes_of(lines: ReadonlyArray<string>): Array<string> {
	return time_spans
		.parse_timeline(lines.join('\n'))
		.spans.filter((span) => span.category === time_spans.TOOL_CATEGORY)
		.map((span) => span.outcome)
}

describe('reading a failure line out of what a josh command printed', () => {
	it('reads a body written as a plain string', () => {
		expect(time_reported_failure.result_text('✗ lint')).toBe('✗ lint')
	})

	// Parsed from JSON rather than written as a literal, which is how a transcript arrives — and the
	// only way to put the empty block a real one holds beside the text blocks.
	it('reads a body written as text blocks', () => {
		const blocks: unknown = JSON.parse('[{"text":"a"},null,{"text":"✗ lint"}]')

		expect(time_reported_failure.result_text(blocks)).toBe('a\n\n✗ lint')
	})

	it('reads a body it cannot parse as empty rather than throwing', () => {
		expect(time_reported_failure.result_text({ nested: true })).toBe('')
	})

	// One block of another shape must not take the rest of the body with it: a whole-array validation
	// would return nothing here, and the red gate below it would read as a success.
	it('keeps the readable blocks of a body holding one it cannot read', () => {
		const blocks: unknown = JSON.parse('[{"type":"image"},{"text":"✗ lint"}]')

		expect(time_reported_failure.has_failure_line(blocks)).toBe(true)
	})

	it('finds the failure line a josh command printed', () => {
		expect(time_reported_failure.has_failure_line(GATE_FAILED_BODY)).toBe(true)
	})

	it('finds it when the caller indented the quoted body', () => {
		expect(time_reported_failure.has_failure_line('    ✗ verification gate failed')).toBe(true)
	})

	it('ignores the character where it does not open a line', () => {
		expect(time_reported_failure.has_failure_line('grep -E "^(✔|✗)" said nothing')).toBe(false)
	})

	it('leaves a green gate alone', () => {
		expect(time_reported_failure.has_failure_line(GATE_PASSED_BODY)).toBe(false)
	})

	// The guard that keeps this from being a guess: only josh's output is written by this repository.
	it('ignores a failure line in a call that ran no josh command', () => {
		expect(time_reported_failure.is_reported_failure('', true)).toBe(false)
	})

	it('reports a failure line in a call that ran one', () => {
		expect(time_reported_failure.is_reported_failure(JOSH_GATE, true)).toBe(true)
	})
})

describe('the outcome a span carries', () => {
	it('marks a piped red gate failed even though the pipe reported success', () => {
		const lines = [bash_call(0, 'g1', GATE_COMMAND), bash_result(1, 'g1', GATE_FAILED_BODY, false)]

		expect(outcomes_of(lines)).toStrictEqual([time_spans.FAILED_OUTCOME])
	})

	it('marks it failed when the harness recorded no outcome at all', () => {
		const lines = [bash_call(0, 'g1', GATE_COMMAND), bash_result(1, 'g1', GATE_FAILED_BODY)]

		expect(outcomes_of(lines)).toStrictEqual([time_spans.FAILED_OUTCOME])
	})

	it('leaves a green gate read through the same pipe a success', () => {
		const lines = [bash_call(0, 'g1', GATE_COMMAND), bash_result(1, 'g1', GATE_PASSED_BODY, false)]

		expect(outcomes_of(lines)).toStrictEqual([time_spans.OK_OUTCOME])
	})

	// The promotion goes one way only: what the harness marked failed stays failed.
	it('never lowers a call the harness marked failed', () => {
		const lines = [bash_call(0, 'g1', GATE_COMMAND), bash_result(1, 'g1', GATE_PASSED_BODY, true)]

		expect(outcomes_of(lines)).toStrictEqual([time_spans.FAILED_OUTCOME])
	})
})

// The acceptance criterion: the aggregate `josh time` prints, taken from a transcript holding the
// piped red gate and the re-run that answered it.
describe('the failure aggregate over a transcript holding a piped red gate', () => {
	const RERUN_MINUTES = 2
	const lines = [
		bash_call(0, 'g1', GATE_COMMAND),
		bash_result(1, 'g1', GATE_FAILED_BODY, false),
		bash_call(2, 'g2', GATE_COMMAND),
		bash_result(2 + RERUN_MINUTES, 'g2', GATE_PASSED_BODY, false),
	]

	it('counts the red gate and charges the run that followed it as rework', () => {
		const totals = time_failures.build_failures(time_spans.parse_timeline(lines.join('\n')).spans)

		expect(totals).toStrictEqual({
			failed_call_count: 1,
			unknown_call_count: 0,
			rerun_ms: RERUN_MINUTES * MINUTE_MS,
			is_measured: true,
		})
	})

	// What the same transcript reported before this change, so the case says what was recovered.
	it('reported no failure at all while only the harness outcome was read', () => {
		const { spans } = time_spans.parse_timeline(lines.join('\n'))
		const harness_only = spans.map((span) => ({ ...span, outcome: time_spans.OK_OUTCOME }))

		expect(time_failures.build_failures(harness_only).failed_call_count).toBe(0)
	})
})
