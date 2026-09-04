import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckTotal } from './time-checks'
import { time_cli } from './time-cli'
import { time_epic, type EpicTimeReport } from './time-epic'
import { time_failures } from './time-failures'
import type { LabelTotal, TimeReport } from './time-report'
import { time_row_cap } from './time-row-cap'
import { time_run } from './time-run'

// The cap as a module and as the flag that reaches it, in one suite (joshuafolkken/kit#1301). The
// command tests sit here rather than in `time-cli.test.ts` so the tables a cut report is built from
// are declared once — a second copy of them beside the second suite is where the two would come to
// disagree about what a capped report looks like.

const MINUTE_MS = 60_000
const ISSUE = 1301
const EPIC = 1262
const CWD = '/Users/someone/Development/kit'
const TOOL_ROWS = 5
const JOSH_ROWS = 3
const CAP = 2
const SESSION_NOTE = '1 session(s)'
const WITHHELD = 'withheld by --top'

function rows(count: number, prefix: string): Array<LabelTotal> {
	return Array.from({ length: count }, (_unused, index) => ({
		label: `${prefix}-${String(index)}`,
		duration_ms: (count - index) * MINUTE_MS,
		call_count: 1,
	}))
}

// The check table carries a conclusion and a merge offset instead of a call count, and the cap is
// asserted to leave it alone — so it is built here in that shape rather than as a tool row.
function check_rows(count: number): Array<CheckTotal> {
	return Array.from({ length: count }, (_unused, index) => ({
		label: `check-${String(index)}`,
		duration_ms: (count - index) * MINUTE_MS,
		conclusion: 'success',
		merge_gap_ms: -MINUTE_MS,
	}))
}

function report(notes: ReadonlyArray<string> = []): TimeReport {
	return {
		scope: `issue #${String(ISSUE)}`,
		started_at: '',
		ended_at: '',
		elapsed_ms: MINUTE_MS,
		span_count: 2,
		turn_count: 1,
		tool_call_count: 1,
		round_trip_count: 1,
		ms_per_round_trip: MINUTE_MS,
		model_ms_per_round_trip: MINUTE_MS,
		categories: { model_ms: MINUTE_MS, tool_ms: 0, human_ms: 0, ci_ms: 0 },
		has_ci_data: false,
		notes: [...notes],
		phases: [],
		by_tool: rows(TOOL_ROWS, 'tool'),
		by_josh_command: rows(JOSH_ROWS, 'josh'),
		by_check: check_rows(JOSH_ROWS),

		failures: { ...time_failures.NO_FAILURES },
	}
}

function epic_report(): EpicTimeReport {
	return {
		scope: `epic #${String(EPIC)}`,
		epic_number: EPIC,
		children: [
			{ issue_number: ISSUE, status: 'measured', ms_per_turn: MINUTE_MS, report: report() },
		],
		total_ms: MINUTE_MS,
		categories: { model_ms: MINUTE_MS, tool_ms: 0, human_ms: 0, ci_ms: 0 },
		has_transcript_data: true,
		has_ci_data: false,
		timed_count: 1,
		measured_count: 1,
		unmeasured_count: 0,
		trend: { is_comparable: false, first_ms_per_turn: 0, last_ms_per_turn: 0, child_count: 1 },
		notes: [],
	}
}

function tool_note(kept: number): string {
	return time_row_cap.truncation_note(time_row_cap.TOOL_TABLE, kept, TOOL_ROWS)
}

describe('time_row_cap.cap_report — no cap', () => {
	// The acceptance criterion the option is written around: a call that names no cap has to produce
	// exactly what the command produced before this module existed.
	it('returns the very report it was given when no cap was named', () => {
		const built = report()

		expect(time_row_cap.cap_report(built, undefined)).toBe(built)
	})

	it('leaves both tables and the notes untouched when no cap was named', () => {
		const capped = time_row_cap.cap_report(report([SESSION_NOTE]), undefined)

		expect(capped.by_tool).toHaveLength(TOOL_ROWS)
		expect(capped.by_josh_command).toHaveLength(JOSH_ROWS)
		expect(capped.notes).toEqual([SESSION_NOTE])
	})
})

describe('time_row_cap.cap_report — a cap that cuts', () => {
	it('keeps the highest rows of both tables and drops the tail', () => {
		const capped = time_row_cap.cap_report(report(), CAP)

		expect(capped.by_tool.map((row) => row.label)).toEqual(['tool-0', 'tool-1'])
		expect(capped.by_josh_command.map((row) => row.label)).toEqual(['josh-0', 'josh-1'])
	})

	// A table that silently stops at N reads as "the rest were zero", which is the misreading the
	// whole report withholds its unmeasured rows to prevent.
	it('says how many rows it withheld, per table', () => {
		const capped = time_row_cap.cap_report(report([SESSION_NOTE]), CAP)

		expect(capped.notes).toEqual([
			SESSION_NOTE,
			tool_note(CAP),
			time_row_cap.truncation_note(time_row_cap.JOSH_TABLE, CAP, JOSH_ROWS),
		])
		expect(capped.notes[1]).toContain(`3 ${WITHHELD}`)
	})

	it('does not mutate the report it was given', () => {
		const built = report()

		time_row_cap.cap_report(built, CAP)

		expect(built.by_tool).toHaveLength(TOOL_ROWS)
		expect(built.notes).toEqual([])
	})

	// Named apart from the two capped tables: its rows are one per CI job, so a cut there hides a
	// check rather than a tail.
	it('leaves the CI check table uncapped', () => {
		expect(time_row_cap.cap_report(report(), CAP).by_check).toHaveLength(JOSH_ROWS)
	})
})

describe('time_row_cap.cap_report — a cap above the row count', () => {
	it('withholds nothing and adds no note when the cap exceeds both tables', () => {
		const capped = time_row_cap.cap_report(report([SESSION_NOTE]), TOOL_ROWS + 1)

		expect(capped.by_tool).toHaveLength(TOOL_ROWS)
		expect(capped.by_josh_command).toHaveLength(JOSH_ROWS)
		expect(capped.notes).toEqual([SESSION_NOTE])
	})

	// The boundary: a cap equal to the row count keeps every row, so saying rows were withheld there
	// would be a note about nothing.
	it('adds no note for the table whose length equals the cap', () => {
		const capped = time_row_cap.cap_report(report(), JOSH_ROWS)

		expect(capped.by_josh_command).toHaveLength(JOSH_ROWS)
		expect(capped.notes).toEqual([tool_note(JOSH_ROWS)])
	})
})

describe('time_row_cap.cap_epic_report', () => {
	it('returns the very epic report it was given when no cap was named', () => {
		const built = epic_report()

		expect(time_row_cap.cap_epic_report(built, undefined)).toBe(built)
	})

	// Where an epic's size actually is: both tables are paid for once per child, so the cap has to
	// reach each child's own report rather than the batch's headline fields.
	it('caps each child’s own tables and notes the truncation there', () => {
		const capped = time_row_cap.cap_epic_report(epic_report(), CAP)
		const [child] = capped.children

		expect(child?.report.by_tool).toHaveLength(CAP)
		expect(child?.report.by_josh_command).toHaveLength(CAP)
		expect(child?.report.notes).toContain(tool_note(CAP))
	})

	it('leaves the batch’s own fields alone', () => {
		const capped = time_row_cap.cap_epic_report(epic_report(), CAP)

		expect(capped.notes).toEqual([])
		expect(capped.total_ms).toBe(MINUTE_MS)
	})
})

const state = { printed: [] as Array<string> }

function capture(message: unknown): void {
	state.printed.push(String(message))
}

beforeEach(() => {
	state.printed = []
	vi.spyOn(console, 'info').mockImplementation(capture)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function output(): string {
	return state.printed.join('\n')
}

function stub_run(): void {
	vi.spyOn(time_run, 'build_run_report').mockResolvedValue(report([SESSION_NOTE]))
}

describe('josh time --top — one run', () => {
	// The acceptance criterion, read through the command: without the flag the JSON is what it was
	// before the cap existed, field for field and row for row.
	it('carries every row when no --top was named', async () => {
		stub_run()
		await time_cli.run(['--issue', String(ISSUE), '--json'], CWD)

		expect(JSON.parse(output())).toEqual(report([SESSION_NOTE]))
	})

	it('cuts both tables and says how many rows it withheld', async () => {
		stub_run()
		await time_cli.run(['--issue', String(ISSUE), '--top', String(CAP), '--json'], CWD)

		expect(JSON.parse(output())).toMatchObject({
			by_tool: rows(TOOL_ROWS, 'tool').slice(0, CAP),
			by_josh_command: rows(JOSH_ROWS, 'josh').slice(0, CAP),
			notes: [SESSION_NOTE, tool_note(CAP), expect.stringContaining(WITHHELD)],
		})
	})

	// A cap above the row count is not a truncation, and a note there would report rows withheld that
	// nobody withheld.
	it('says nothing about truncation when the cap exceeds the row count', async () => {
		stub_run()
		await time_cli.run(['--issue', String(ISSUE), '--top', String(TOOL_ROWS), '--json'], CWD)

		expect(JSON.parse(output())).toEqual(report([SESSION_NOTE]))
		expect(output()).not.toContain(WITHHELD)
	})

	// The cap shapes the record both renderings are made from, so `--top` means the same thing with
	// and without `--json`.
	it('applies to the text report too', async () => {
		stub_run()
		await time_cli.run(['--issue', String(ISSUE), '--top', String(CAP)], CWD)

		expect(output()).toContain(WITHHELD)
		expect(output()).not.toContain('tool-4')
	})
})

describe('josh time --top — one epic', () => {
	it('caps each child’s tables under --epic', async () => {
		vi.spyOn(time_epic, 'build_epic_report').mockResolvedValue(epic_report())
		await time_cli.run(['--epic', String(EPIC), '--top', String(CAP), '--json'], CWD)

		expect(JSON.parse(output())).toMatchObject({
			children: [{ report: { by_tool: rows(TOOL_ROWS, 'tool').slice(0, CAP) } }],
		})
	})

	// The epic's text output renders no per-tool table at all, and a child's note block is the one
	// place it explains why a child's GitHub half is missing — so a truncation note printed there
	// would dilute exactly the signal that block exists for.
	it('keeps the truncation note out of the epic’s text output', async () => {
		vi.spyOn(time_epic, 'build_epic_report').mockResolvedValue(epic_report())
		await time_cli.run(['--epic', String(EPIC), '--top', String(CAP)], CWD)

		expect(output()).toContain(`#${String(ISSUE)}`)
		expect(output()).not.toContain(WITHHELD)
	})
})
