import { describe, expect, it } from 'vitest'
import { time_invocations, type InvocationTotal } from './time-invocations'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'

// What each call of a repeated command cost (joshuafolkken/kit#1311).
//
// A row here is a *call*, not a span, so every case says when its calls closed: the order the
// durations print in is the order the calls went out, and the two fragments of a bracketing call are
// rejoined by the id they share. `time-span-fixture.ts` already builds a span that carries both, so
// this suite varies the duration on top of it rather than declaring a third span builder.

const { MINUTE_MS } = time_span_fixture
const PNPM_LABEL = 'Bash: pnpm'
const GATE_COMMAND = 'josh gate'

function call(end_minute: number, minutes: number, label: string, josh_command = ''): Span {
	return {
		...time_span_fixture.outcome_span(end_minute, time_spans.UNKNOWN_OUTCOME, label, josh_command),
		duration_ms: minutes * MINUTE_MS,
	}
}

function shaped(rows: ReadonlyArray<InvocationTotal>): Array<[string, number, Array<number>]> {
	return rows.map((row) => [
		row.label,
		row.call_count,
		row.durations_ms.map((duration_ms) => duration_ms / MINUTE_MS),
	])
}

describe('time_invocations.build_invocations — the rows', () => {
	// The complaint the issue was filed for: `josh gate 4 call(s), 2.2 min` is the same row whether the
	// four runs were even or whether the last took three times the first.
	it('lists each call of a repeated command in the order they went out', () => {
		const rows = time_invocations.build_invocations([
			call(2, 1, PNPM_LABEL, GATE_COMMAND),
			call(6, 3, PNPM_LABEL, GATE_COMMAND),
			call(9, 2, PNPM_LABEL, GATE_COMMAND),
		])

		expect(shaped(rows)).toEqual([[GATE_COMMAND, 3, [1, 3, 2]]])
	})

	it('leaves out a command that was called once', () => {
		const rows = time_invocations.build_invocations([
			call(2, 1, 'Read'),
			call(4, 1, 'Read'),
			call(6, 5, 'Bash: git'),
		])

		expect(rows.map((row) => row.label)).toEqual(['Read'])
	})

	it('ranks the rows by what the command cost in total', () => {
		const rows = time_invocations.build_invocations([
			call(2, 1, 'Read'),
			call(3, 1, 'Read'),
			call(8, 4, 'Bash: git'),
			call(13, 4, 'Bash: git'),
		])

		expect(rows.map((row) => row.label)).toEqual(['Bash: git', 'Read'])
	})
})

// The other half of the question: which spans are one call, and which calls are one command.
describe('time_invocations.build_invocations — what counts as one call', () => {
	// `Bash: pnpm` alone would put `josh gate` and `josh lint` on one row and print their durations as
	// though they were the same command's.
	it('keys a josh invocation by its subcommand rather than by the shell it ran in', () => {
		const rows = time_invocations.build_invocations([
			call(2, 1, PNPM_LABEL, GATE_COMMAND),
			call(4, 2, PNPM_LABEL, 'josh lint'),
			call(7, 3, PNPM_LABEL, GATE_COMMAND),
		])

		expect(shaped(rows)).toEqual([[GATE_COMMAND, 2, [1, 3]]])
	})

	// One call bracketing a delegated unit comes back as a head and a tail. Two rows would report a
	// call the run never made; dropping the tail would report the call as shorter than it was.
	it('rejoins the two fragments of one bracketing call', () => {
		const head = call(5, 2, 'Task')
		const rows = time_invocations.build_invocations([
			head,
			{ ...call(9, 1, 'Task'), call_id: head.call_id, is_continuation: true },
			call(12, 3, 'Task'),
		])

		expect(shaped(rows)).toEqual([['Task', 2, [3, 3]]])
	})

	// Every call the transcript could not name shares one label, so a row over them would list
	// durations belonging to unrelated tools.
	it('leaves out the calls it could not name', () => {
		const unknown = time_spans.UNKNOWN_TOOL
		const rows = time_invocations.build_invocations([call(2, 1, unknown), call(4, 1, unknown)])

		expect(rows).toEqual([])
	})

	it('counts tool calls only', () => {
		const thinking = { category: time_spans.MODEL_CATEGORY }
		const rows = time_invocations.build_invocations([
			{ ...call(2, 1, 'Read'), ...thinking },
			{ ...call(4, 1, 'Read'), ...thinking },
		])

		expect(rows).toEqual([])
	})
})

describe('time_invocations.invocation_lines', () => {
	// A heading over an empty table asserts that the question was asked and came back blank, which is
	// not the same as a run where nothing was called twice.
	it('prints nothing at all when no command was called twice', () => {
		expect(time_invocations.invocation_lines([])).toEqual([])
	})

	it('prints the total beside each call’s own duration', () => {
		const rows = time_invocations.build_invocations([
			call(2, 1, PNPM_LABEL, GATE_COMMAND),
			call(6, 3, PNPM_LABEL, GATE_COMMAND),
		])
		const lines = time_invocations.invocation_lines(rows)

		expect(lines[1]).toBe(time_invocations.HEADING)
		expect(lines[2]).toContain(GATE_COMMAND)
		expect(lines[2]).toContain('4.0 min')
		expect(lines[2]).toContain('2 call(s): 60.0 s, 180.0 s')
	})

	// A run edits fifty files, and fifty durations on one line is a row nobody reads. The whole list
	// stays in `--json`, which is what makes counting the rest honest rather than lossy.
	it('counts the durations it did not print', () => {
		const many = Array.from({ length: 14 }, (_unused, index) => call(index + 1, 1, 'Edit'))
		const lines = time_invocations.invocation_lines(time_invocations.build_invocations(many))

		expect(lines[2]).toContain(`+${String(14 - time_invocations.MAX_DURATIONS)} more`)
	})
})
