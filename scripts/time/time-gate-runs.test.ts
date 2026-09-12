import { describe, expect, it } from 'vitest'
import { time_format } from './time-format'
import { time_gate_runs } from './time-gate-runs'
import { time_phase_fixture } from './time-phase-fixture'
import { time_shell } from './time-shell'
import { time_spans, type Span, type SpanOutcome } from './time-spans'

// joshuafolkken/kit#1786: `prompts/review.md` allows one gate per commit plus one wherever an edit
// landed after a gate, and nothing counted against it — run #1749 printed `josh gate — 4 call(s)`
// with no way to tell an allowed re-run of a red gate from a wasted one. These are the two the block
// has to separate, plus the third state it must refuse to guess at.

const { span, GATE_COMMAND, MINUTE_MS } = time_phase_fixture

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

	// A span records the command the line named, and since joshuafolkken/kit#1789 an alias is expanded
	// into that name — so a run that typed `pnpm josh ga` is the same gate as one that typed it in
	// full, rather than a measured zero gates.
	it('counts a gate the run started through its alias', () => {
		const aliased = span(0, 1, {
			josh_command: time_shell.josh_command_of('pnpm josh ga'),
			outcome: time_spans.OK_OUTCOME,
		})

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

// joshuafolkken/kit#1812: the gate is launched into the background (`background-commands.md`), so `by_invocation` sees only
// the two-second dispatch and the `gate` phase only the launch's own seconds. Its real runtime is in
// the background run — the launch to the call that read the output back — and this reads it in the
// shape `ci_cycles` uses: the real length, and the naked part the run spent on it alone.
const GATE_ID = 'gate-bg'

function bg_gate(start_minute: number, minutes: number, extra: Partial<Span> = {}): Span {
	return span(start_minute, minutes, {
		josh_command: GATE_COMMAND,
		outcome: time_spans.OK_OUTCOME,
		background_id: GATE_ID,
		background_ended_ms: (start_minute + minutes) * MINUTE_MS,
		...extra,
	})
}

function gate_join(start_minute: number, minutes: number): Span {
	return span(start_minute, minutes, { reads_background: GATE_ID })
}

describe('time_gate_runs — the backgrounded gate runtime read back', () => {
	// The gate is launched, a review runs beside it for six minutes, and the output is read back only
	// afterwards — so its real runtime is eight minutes and the part it ran alone is two.
	it('reads the gate real duration and the naked part it ran alone', () => {
		const totals = time_gate_runs.build_gate_runs([
			bg_gate(0, 1),
			span(1, 6, { label: 'Skill' }),
			gate_join(7, 1),
		])
		const [window] = totals.windows

		expect(totals.is_runtime_measured).toBe(true)
		expect([window?.duration_ms, window?.naked_ms]).toEqual([8 * MINUTE_MS, 2 * MINUTE_MS])
	})

	it('prints the naked seconds beside the gate window when it was read back', () => {
		const lines = time_gate_runs.gate_run_lines(
			time_gate_runs.build_gate_runs([
				bg_gate(0, 1),
				span(1, 6, { label: 'Skill' }),
				gate_join(7, 1),
			]),
		)

		expect(lines.join('\n')).toContain(time_format.NAKED_PREFIX)
	})
})

describe('time_gate_runs — when the gate runtime is withheld', () => {
	// A gate launched into the background but never read back has no runtime in the transcript, so the
	// block says so rather than reporting the launch's own dispatch seconds as the gate's length.
	it('reports the runtime as not measured when the backgrounded gate was never read back', () => {
		const totals = time_gate_runs.build_gate_runs([bg_gate(0, 1), span(1, 5)])

		expect(totals.run_count).toBe(1)
		expect(totals.is_runtime_measured).toBe(false)
	})

	it('prints not measured rather than a zero for an unread backgrounded gate', () => {
		const lines = time_gate_runs.gate_run_lines(
			time_gate_runs.build_gate_runs([bg_gate(0, 1), span(1, 5)]),
		)

		expect(lines.join('\n')).toContain(time_gate_runs.RUNTIME_HEADING)
		expect(lines.join('\n')).toContain(time_format.NOT_MEASURED)
	})

	// A gate that ran in the foreground carries no background id, so its length is already in the
	// per-invocation table — the block withholds itself rather than reporting a knowable length as
	// unmeasured.
	it('shows no runtime block for a gate that ran only in the foreground', () => {
		const foreground = span(0, 8, { josh_command: GATE_COMMAND, outcome: time_spans.OK_OUTCOME })
		const lines = time_gate_runs.gate_run_lines(time_gate_runs.build_gate_runs([foreground]))

		expect(lines.join('\n')).not.toContain(time_gate_runs.RUNTIME_HEADING)
	})
})
