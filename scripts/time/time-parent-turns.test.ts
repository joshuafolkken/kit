import { describe, expect, it } from 'vitest'
import { time_format } from './time-format'
import { time_parent_turns, type ParentTurnTotals } from './time-parent-turns'
import { time_report } from './time-report'
import { time_report_fixture } from './time-report-fixture'
import { time_shell } from './time-shell'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'

// What a run's turns were spent on (joshuafolkken/kit#1715).
//
// The cases are about the two things the block rests on: a turn is attributed to exactly one
// contributor, and the contributor is decided by a precedence rather than by whichever key happens to
// come first in the turn. Reading it the other way makes the eight shares sum past the turn count, so
// the block stops reconstructing the very number it is a breakdown of.

const { span } = time_span_fixture
const { build, line_of } = time_report_fixture
const PNPM_LABEL = 'Bash: pnpm'
const GH_LABEL = 'Bash: gh'
const READ_LABEL = 'Read'
const EDIT_LABEL = 'Edit'
const ISSUE_STATE = 'josh issue:state'
const NONE = 0
const ONE = 1

function tool(label: string, josh_command = ''): Span {
	return span(time_spans.TOOL_CATEGORY, 1, label, josh_command)
}

function josh(command: string): Span {
	return tool(PNPM_LABEL, command)
}

function thinking(): Span {
	return span(time_spans.MODEL_CATEGORY, 1)
}

// One turn per group of adjacent tool spans, which is the grouping `time-round-trips.ts` already
// defines: a model span between two calls is what separates one turn from the next here, because
// these spans carry no message id.
function turns(...spans: ReadonlyArray<ReadonlyArray<Span>>): Array<Span> {
	return spans.flatMap((calls, index) => (index === 0 ? [...calls] : [thinking(), ...calls]))
}

function totals_of(spans: ReadonlyArray<Span>): ParentTurnTotals {
	return time_parent_turns.build_parent_turns(spans)
}

function count_of(totals: ParentTurnTotals, name: string): number {
	return time_parent_turns.count_for(totals, name)
}

function count_in(spans: ReadonlyArray<Span>, name: string): number {
	return count_of(totals_of(spans), name)
}

describe('time_parent_turns.build_parent_turns — the parent loop', () => {
	it('reads a raw gh call as issue bookkeeping', () => {
		expect(count_in([tool(GH_LABEL)], time_parent_turns.ISSUE_BOOKKEEPING)).toBe(ONE)
	})

	it('reads a batched issue read as issue bookkeeping too, so the cut shows in the same row', () => {
		expect(count_in([josh('josh issue:read')], time_parent_turns.ISSUE_BOOKKEEPING)).toBe(ONE)
	})

	it('separates the progress poll from the child confirmation', () => {
		const totals = totals_of(turns([josh('josh run:progress')], [josh(ISSUE_STATE)]))

		expect(count_of(totals, time_parent_turns.PROGRESS_POLL)).toBe(ONE)
		expect(count_of(totals, time_parent_turns.CHILD_CONFIRMATION)).toBe(ONE)
	})

	it("reads the loop's own asks as loop asks", () => {
		const spans = turns([josh('josh backlog:next')], [josh('josh backlog:budget')])

		expect(count_in(spans, time_parent_turns.LOOP_ASK)).toBe(2)
	})

	// The return to the default branch is typed `pnpm josh ms`, and the key carries the command that
	// alias stands for (joshuafolkken/kit#1789) — matched against the alias, every one of those turns
	// would fall to `other` and the parent's own loop would read as unclassifiable work.
	it('reads the default-branch return as child confirmation, typed as an alias', () => {
		const spans = [josh(time_shell.josh_command_of('pnpm josh ms'))]

		expect(count_in(spans, time_parent_turns.CHILD_CONFIRMATION)).toBe(ONE)
	})

	it('reads a delegated child as dispatch', () => {
		expect(count_in([tool('Agent')], time_parent_turns.DISPATCH)).toBe(ONE)
	})
})

describe('time_parent_turns.build_parent_turns — one turn, one contributor', () => {
	it('reads a plain file read as investigation', () => {
		expect(count_in([tool(READ_LABEL)], time_parent_turns.INVESTIGATION)).toBe(ONE)
	})

	// The precedence is the definition, not a display order: the edit is what the turn was for.
	it('attributes a turn that edited and also read to implementation alone', () => {
		const totals = totals_of([tool(READ_LABEL), tool(EDIT_LABEL)])

		expect(count_of(totals, time_parent_turns.IMPLEMENTATION)).toBe(ONE)
		expect(count_of(totals, time_parent_turns.INVESTIGATION)).toBe(NONE)
	})

	it('puts a key no contributor claims under other rather than dropping the turn', () => {
		expect(count_in([tool('Bash: docker')], time_parent_turns.OTHER)).toBe(ONE)
	})

	// Without this the block stops being a breakdown of anything: a turn counted twice makes the eight
	// shares sum past 100%, and a turn counted nowhere makes them sum short of it.
	it('counts every turn exactly once, so the rows reconstruct the turn count', () => {
		const totals = totals_of(
			turns([tool(GH_LABEL)], [josh(ISSUE_STATE), tool(READ_LABEL)], [tool(EDIT_LABEL)]),
		)
		const names = time_parent_turns.CONTRIBUTOR_NAMES
		const counted = names.reduce((sum, name) => sum + count_of(totals, name), NONE)

		expect(totals.turn_count).toBe(3)
		expect(counted).toBe(3)
	})
})

describe('time_parent_turns.contributor_of_trip', () => {
	// The per-contributor cost block labels a trip by this, so it has to answer the same purpose the
	// count does — one mapping, or the two tables disagree about what a turn was for.
	it('names the purpose a round trip served', () => {
		expect(time_parent_turns.contributor_of_trip([tool(EDIT_LABEL)])).toBe(
			time_parent_turns.IMPLEMENTATION,
		)
	})

	it('reads a trip that edited and also read as implementation, by the same precedence', () => {
		expect(time_parent_turns.contributor_of_trip([tool(READ_LABEL), tool(EDIT_LABEL)])).toBe(
			time_parent_turns.IMPLEMENTATION,
		)
	})
})

describe('time_parent_turns.parent_turn_lines — the block', () => {
	it('prints one row per contributor, under the heading', () => {
		const lines = time_parent_turns.parent_turn_lines(totals_of([tool(GH_LABEL)]))

		expect(lines).toContain(time_parent_turns.HEADING)
		expect(lines).toHaveLength(time_parent_turns.CONTRIBUTOR_NAMES.length + 2)
	})

	it('prints the count and its share of the turns', () => {
		const spans = turns([tool(GH_LABEL)], [tool(GH_LABEL)], [tool(READ_LABEL)], [tool(READ_LABEL)])
		const text = time_parent_turns.parent_turn_lines(totals_of(spans)).join('\n')

		expect(line_of(text, time_parent_turns.ISSUE_BOOKKEEPING)).toContain('50.0%')
	})

	// Zero here would read as a run that made no turn of that kind, which is the one answer an unread
	// transcript cannot support.
	it('says the rows are unmeasured when no transcript was read, rather than printing zeros', () => {
		const text = time_parent_turns.parent_turn_lines(time_parent_turns.NO_PARENT_TURNS).join('\n')

		expect(text).toContain(time_format.NOT_MEASURED)
		expect(text).not.toContain('0.0%')
	})
})

describe('time_report — the block on a report', () => {
	it('carries the contributor totals on the report it builds', () => {
		expect(build([tool(GH_LABEL)]).parent_turns.turn_count).toBe(ONE)
	})

	it('prints the block in the formatted report', () => {
		const text = time_report.format_report(build([tool(GH_LABEL)]))

		expect(text).toContain(time_parent_turns.HEADING)
	})
})
