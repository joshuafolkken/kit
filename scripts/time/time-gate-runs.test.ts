import { describe, expect, it } from 'vitest'
import { time_format } from './time-format'
import { time_gate_runs } from './time-gate-runs'
import { time_phase_fixture } from './time-phase-fixture'
import { time_spans, type Span, type SpanOutcome } from './time-spans'

// joshuafolkken/kit#1786: `prompts/review.md` allows one gate per commit plus one wherever an edit
// landed after a gate, and nothing counted against it — run #1749 printed `josh gate — 4 call(s)`
// with no way to tell an allowed re-run of a red gate from a wasted one. These are the two the block
// has to separate, plus the third state it must refuse to guess at.

const { span, GATE_COMMAND } = time_phase_fixture

function gate(start_minute: number, outcome: SpanOutcome): Span {
	return span(start_minute, 1, { josh_command: GATE_COMMAND, outcome })
}

function other(start_minute: number): Span {
	return span(start_minute, 1, { josh_command: 'josh lint', outcome: time_spans.OK_OUTCOME })
}

// The module builds its key from the gate's own command name and the fixture spells it out, so the
// two could drift apart and every case below would go on passing against a key nothing produces.
describe('time_gate_runs — the key it matches a gate span on', () => {
	it('is the same spelling a gate span actually carries', () => {
		expect(time_gate_runs.GATE_KEY).toBe(GATE_COMMAND)
	})

	// A span records the spelling the command line used, and nothing expands an alias into it — so a
	// run that typed `pnpm josh ga` would otherwise report a measured zero gates.
	it('counts a gate the run started through its alias', () => {
		const aliased = span(0, 1, { josh_command: 'josh ga', outcome: time_spans.OK_OUTCOME })

		expect(time_gate_runs.build_gate_runs([aliased]).run_count).toBe(1)
	})
})

describe('time_gate_runs — how many gates a run started', () => {
	it('counts every gate call in the run', () => {
		const totals = time_gate_runs.build_gate_runs([
			gate(0, time_spans.OK_OUTCOME),
			other(2),
			gate(4, time_spans.OK_OUTCOME),
		])

		expect(totals.run_count).toBe(2)
	})

	it('leaves the first gate in neither bucket, since every run is allowed one', () => {
		const totals = time_gate_runs.build_gate_runs([gate(0, time_spans.OK_OUTCOME)])

		expect(totals.after_red_count).toBe(0)
		expect(totals.undetermined_count).toBe(0)
	})

	it('reads a gate that follows a red gate as the re-run the procedure requires', () => {
		const totals = time_gate_runs.build_gate_runs([
			gate(0, time_spans.FAILED_OUTCOME),
			gate(2, time_spans.OK_OUTCOME),
		])

		expect(totals.after_red_count).toBe(1)
		expect(totals.undetermined_count).toBe(0)
	})

	it('refuses to classify a gate whose predecessor had no readable outcome', () => {
		const totals = time_gate_runs.build_gate_runs([
			gate(0, time_spans.UNKNOWN_OUTCOME),
			gate(2, time_spans.OK_OUTCOME),
		])

		expect(totals.undetermined_count).toBe(1)
		expect(totals.after_red_count).toBe(0)
	})
})

describe('time_gate_runs — which gate answers which', () => {
	it('pairs each gate with the one that actually ran before it, not the one listed before it', () => {
		const totals = time_gate_runs.build_gate_runs([
			gate(4, time_spans.OK_OUTCOME),
			gate(0, time_spans.FAILED_OUTCOME),
		])

		expect(totals.after_red_count).toBe(1)
	})

	it('does not count the tail of a call split around a delegated unit as a second gate', () => {
		const head = gate(0, time_spans.OK_OUTCOME)
		const tail = { ...gate(2, time_spans.OK_OUTCOME), is_continuation: true }

		expect(time_gate_runs.build_gate_runs([head, tail]).run_count).toBe(1)
	})
})

describe('time_gate_runs — what is withheld rather than reported as zero', () => {
	it('withholds the counts when no span was read at all', () => {
		expect(time_gate_runs.build_gate_runs([]).is_measured).toBe(false)
	})

	it('reports a real zero for a transcript that was read and started no gate', () => {
		const totals = time_gate_runs.build_gate_runs([other(0)])

		expect(totals.is_measured).toBe(true)
		expect(totals.run_count).toBe(0)
	})
})

describe('time_gate_runs — the printed block', () => {
	it('names the allowance the count is read against', () => {
		const lines = time_gate_runs.gate_run_lines(
			time_gate_runs.build_gate_runs([gate(0, time_spans.OK_OUTCOME)]),
		)

		expect(lines.join('\n')).toContain(time_gate_runs.ALLOWANCE_NOTE)
	})

	it('prints the count beside the label rather than in prose', () => {
		const lines = time_gate_runs.gate_run_lines(
			time_gate_runs.build_gate_runs([
				gate(0, time_spans.FAILED_OUTCOME),
				gate(2, time_spans.OK_OUTCOME),
			]),
		)

		expect(lines.join('\n')).toContain(time_gate_runs.RUNS_LABEL)
		expect(lines.join('\n')).toContain(time_gate_runs.AFTER_RED_LABEL)
	})

	it('says the counts were not measured rather than printing zeroes', () => {
		const lines = time_gate_runs.gate_run_lines(time_gate_runs.build_gate_runs([]))

		expect(lines.join('\n')).toContain(time_format.NOT_MEASURED)
	})
})
