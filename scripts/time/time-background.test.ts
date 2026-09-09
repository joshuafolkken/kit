import { describe, expect, it } from 'vitest'
import { time_background } from './time-background'
import { time_phase_fixture } from './time-phase-fixture'
import { time_phases } from './time-phases'
import type { Span } from './time-spans'

// joshuafolkken/kit#1662: a command taken into the background was recorded as its launch call and
// nothing more, so `gate` counted the two seconds the launch took while the gate itself ran for
// minutes under whatever span happened to come next.
//
// The timeline builder is `time-phase-fixture.ts`'s, because every question here is about *when* a
// span sits rather than about how it was classified.

const { MINUTE_MS, span, GATE_COMMAND, PR_COMMAND } = time_phase_fixture

const GATE_ID = 'b3sods4bd'
const OTHER_ID = 'second-run'
const LAUNCH_BODY = `Command running in background with ID: ${GATE_ID}. Output is being written to: /tmp/tasks/${GATE_ID}.output`
const JOIN_COMMAND = `tail -25 /private/tmp/claude-501/proj/session/tasks/${GATE_ID}.output`

function launch(start_minute: number, minutes: number, id = GATE_ID, command = GATE_COMMAND): Span {
	return span(start_minute, minutes, { josh_command: command, background_id: id })
}

function join(start_minute: number, minutes: number, id = GATE_ID): Span {
	return span(start_minute, minutes, { reads_background: id })
}

function minutes_of(duration_ms: number): number {
	return duration_ms / MINUTE_MS
}

// The shape the issue is about: the gate is launched, the review runs beside it for six minutes, and
// the output is read back only afterwards.
const OVERLAPPED: ReadonlyArray<Span> = [launch(0, 1), span(1, 6, { label: 'Skill' }), join(7, 1)]

// Two commands outstanding at once, and the second's run is the *longer* of the two — so ordering by
// run length would charge everything after the second launch to the first. The gate runs minute 0 to
// minute 7; the pull request is launched at minute 2 and runs to minute 11.
const OVERLAPPING: ReadonlyArray<Span> = [
	launch(0, 1),
	launch(2, 1, OTHER_ID, PR_COMMAND),
	span(4, 1),
	join(6, 1),
	join(10, 1, OTHER_ID),
]

describe('time_background.launch_id', () => {
	it('reads the id the harness assigned out of the launch result', () => {
		expect(time_background.launch_id(LAUNCH_BODY)).toBe(GATE_ID)
	})

	// Every other tool result in a transcript goes through the same reader, so a body that says nothing
	// about a background run has to answer with nothing rather than with its first word.
	it('answers with nothing for a body that launched nothing', () => {
		expect(time_background.launch_id('done')).toBe(time_background.NO_BACKGROUND)
	})
})

describe('time_background.read_id', () => {
	it('reads the id out of the output path the joining call names', () => {
		expect(time_background.read_id(JOIN_COMMAND)).toBe(GATE_ID)
	})

	// This repository's issue and comment bodies quote command chains constantly, so a path merely
	// described inside a quoted argument is text rather than a join of anything.
	it('ignores an output path that only appears inside quoted text', () => {
		const described = `gh api repos/o/r/issues/1/comments -f body="read tasks/${GATE_ID}.output"`

		expect(time_background.read_id(described)).toBe(time_background.NO_BACKGROUND)
	})
})

describe('time_background.read_id_of', () => {
	it('reads the path out of a call that names the output file', () => {
		expect(time_background.read_id_of({ command: JOIN_COMMAND })).toBe(GATE_ID)
	})

	// `BashOutput` is the other spelling of the same join, and it carries the shell id in a field
	// rather than naming a path — so a reader that matched only the path would report every run
	// joined that way as never read, which is the defect this module exists to remove.
	it('reads the shell id a tool carries in a field of its own', () => {
		expect(time_background.read_id_of({ bash_id: GATE_ID })).toBe(GATE_ID)
	})

	it('answers with nothing for a call that joins nothing', () => {
		expect(time_background.read_id_of({ command: 'git status' })).toBe(
			time_background.NO_BACKGROUND,
		)
	})
})

describe('time_background.runs', () => {
	it('pairs a launch with the call that reads its output', () => {
		const [run] = time_background.runs(OVERLAPPED)

		expect([run?.is_read, minutes_of(run?.ended_ms ?? 0)]).toEqual([true, 8])
	})

	// A run reads one output file several times — a `tail` and then a few `grep`s — and every reading
	// after the first is work on a result already in hand rather than time spent waiting for it.
	it('closes the run at the first reading rather than the last', () => {
		const [run] = time_background.runs([launch(0, 1), join(3, 1), join(6, 2)])

		expect(minutes_of(run?.ended_ms ?? 0)).toBe(4)
	})

	it('reports a launch nobody read back as unread', () => {
		const [run] = time_background.runs([launch(0, 1), span(1, 5)])

		expect(run?.is_read).toBe(false)
	})
})

describe('time_background.positioned', () => {
	// The measurement the issue asks for: what the command took, which is the field a per-invocation
	// row reads, while its share of the wall clock is untouched so the phase totals still reconstruct
	// the elapsed time.
	it('gives the launch the length of the command it started', () => {
		const [placed] = time_background.positioned(OVERLAPPED)

		expect([
			minutes_of(placed?.own_duration_ms ?? 0),
			minutes_of(placed?.duration_ms ?? 0),
		]).toEqual([8, 1])
	})

	it('stamps the spans inside the window with the command they ran beside', () => {
		const placed = time_background.positioned(OVERLAPPED)

		expect(placed.map((one) => one.background_command)).toEqual([
			GATE_COMMAND,
			GATE_COMMAND,
			GATE_COMMAND,
		])
	})

	// A launch nobody read back has no window, so there is nothing to widen and nothing to stamp — the
	// launch seconds stay exactly what the transcript recorded.
	it('leaves an unread launch at the length its own call took', () => {
		const [placed] = time_background.positioned([launch(0, 1), span(1, 5)])

		expect(minutes_of(placed?.own_duration_ms ?? 0)).toBe(1)
	})

	it('leaves a run that backgrounded nothing exactly as it was', () => {
		const plain = [span(0, 1), span(1, 2)]

		expect(time_background.positioned(plain)).toEqual(plain)
	})
})

describe('time_background.positioned — two commands outstanding at once', () => {
	// An unread launch inside another command's window is still its own run: resolved by the window it
	// merely sits in, it would be stamped with a second command and its minutes charged to that phase.
	it('does not stamp an unread launch with the enclosing command', () => {
		const spans = [launch(0, 1), launch(2, 1, OTHER_ID, PR_COMMAND), join(6, 1)]

		expect(time_background.positioned(spans)[1]?.background_command).toBe(PR_COMMAND)
	})

	it('charges a span to the run launched most recently before it', () => {
		expect(time_background.positioned(OVERLAPPING)[2]?.background_command).toBe(PR_COMMAND)
	})

	// The regression the enclosing lookup had: the second launch sits inside the first's window, so a
	// launch placed by that window is handed the first command's length rather than its own.
	it('gives a second launch inside another window its own length', () => {
		const placed = time_background.positioned(OVERLAPPING)

		expect(minutes_of(placed[1]?.own_duration_ms ?? 0)).toBe(9)
	})
})

describe('time_background.unread_phases', () => {
	it('names the phase whose command was never read back', () => {
		const unread = time_background.unread_phases([launch(0, 1), span(1, 5)])

		expect([...unread]).toEqual([time_phases.GATE_PHASE])
	})

	it('names nothing where the command was read back', () => {
		expect([...time_background.unread_phases(OVERLAPPED)]).toEqual([])
	})
})
