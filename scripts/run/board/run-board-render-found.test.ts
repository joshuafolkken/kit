import { stripVTControlCharacters } from 'node:util'
import { run_event_overrun, type OverrunNote } from '#scripts/run/event/run-event-overrun'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { Found } from './run-board-found'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#4772, joshuafolkken/kit#4818: a merged row ends on its lane's net minutes and what
// its overrun investigation came to — the numbers of the Issues filed during its child among it, the
// spinner (🔍 where none turns) while the investigation runs. joshuafolkken/kit#4880: the child's own
// filings come before the investigation, the investigation's after it, each group two spaces apart.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header, lines_of } = run_board_render_fixture
const DONE = 4711
const SPINNER = '⠋'
const STILL = '🔍'
const FILED = ['4768', '4769', '4770']
const MINUTES = 52
const RECURRED = 'recurred #4790'
const CI_WAIT = 'none: CI wait'
const NARROW = 87
const PANE_ROWS = 60
const WITHIN: OverrunNote = { kind: 'within', issue: DONE, minutes: 18 }
const STARTED_NOTE: OverrunNote = {
	kind: 'started',
	issue: DONE,
	minutes: MINUTES,
	pid: 1,
	start: undefined,
}

function row_of(status: ItemStatus): BoardRow {
	return {
		number: DONE,
		title: `Issue ${String(DONE)}`,
		kind: undefined,
		state: status.state,
		status,
		waits: [],
		reason: undefined,
	}
}

const MERGED: ItemStatus = { state: 'merged', started_ms: STARTED, ended_ms: NOW - MINUTE }

function found_of(overrun: OverrunNote | undefined, extra: Partial<Found> = {}): Found {
	const minutes = overrun !== undefined && 'minutes' in overrun ? overrun.minutes : undefined

	return { filed: [], overrun_filed: [], minutes, overrun, is_investigating: false, ...extra }
}

function ended(result: string): Found {
	return found_of({ kind: 'ended', issue: DONE, result }, { minutes: MINUTES })
}

function board(
	found: Found | undefined,
	extra: Partial<BoardHeader> = {},
	status: ItemStatus = MERGED,
): BoardHeader {
	return header({
		layout: { ...EMPTY_LAYOUT, active: [row_of(status)] },
		found: new Map(found === undefined ? [] : [[DONE, found]]),
		...extra,
	})
}

function row_line(board_header: BoardHeader): string {
	return lines_of(board_header).find((line) => line.includes(String(DONE))) ?? ''
}

function done_line(found: Found | undefined, extra: Partial<BoardHeader> = {}): string {
	return row_line(board(found, extra))
}

describe('run_board_render — a merged row’s net minutes', () => {
	it('ends on the minutes alone at or under the threshold', () => {
		expect(done_line(found_of(WITHIN))).toMatch(/\S \s*18′$/u)
	})

	it('says `?′  ⏭` and why the investigation was skipped', () => {
		const skipped = found_of({ kind: 'skipped', issue: DONE, reason: 'ledger split' })

		expect(done_line(skipped)).toMatch(/ {2}\?′ {2}⏭ ledger split$/u)
	})

	it('says `?′  ⏭ no record` where its merge left no note', () => {
		expect(done_line(undefined)).toMatch(/ {2}\?′ {2}⏭ no record$/u)
	})

	it('draws none on a board that read no stream', () => {
		expect(done_line(undefined, { found: undefined })).toMatch(/Issue 4711\s+\S+$/u)
	})
})

// joshuafolkken/kit#4880: the case #4834's row drew as `47′ 🔍 4847, 4856`.
describe('run_board_render — a merged row’s filings by origin', () => {
	const MIXED = { ...ended(run_event_overrun.FILED_RESULT), minutes: 47 }

	it('draws the child’s own filings before 🔍 and the investigation’s after it', () => {
		const line = done_line({ ...MIXED, filed: ['4847'], overrun_filed: ['4856'] })

		expect(line).toMatch(/47′ {2}4847 {2}🔍 4856$/u)
	})

	it('draws the investigation’s filings alone after 🔍', () => {
		expect(done_line({ ...MIXED, overrun_filed: ['4856'] })).toMatch(/47′ {2}🔍 4856$/u)
	})
})

// joshuafolkken/kit#4858: causes folded into an open issue file none, so the result names it.
describe('run_board_render — a merged row’s folded causes', () => {
	it('says `↪N` for each issue folded into, after the child’s own filings', () => {
		const folded = run_event_overrun.folded_result([4801, 4802])
		const line = done_line({ ...ended(folded), filed: ['4768'] })

		expect(line).toMatch(/52′ {2}4768 {2}🔍 ↪4801, ↪4802$/u)
		expect(line).not.toContain('#4801')
	})
})

describe('run_board_render — a merged row’s finished investigation', () => {
	it('ends on 🔍 and the numbers it filed, with no `#`', () => {
		const line = done_line({ ...ended(run_event_overrun.FILED_RESULT), overrun_filed: FILED })

		expect(line).toMatch(/52′ {2}🔍 4768, 4769, 4770$/u)
		expect(line).not.toContain('#4768')
	})

	it('says `∅` and the reason none was filed', () => {
		expect(done_line(ended(CI_WAIT))).toMatch(/52′ {2}🔍 ∅ CI wait$/u)
	})

	it('cuts a long reason', () => {
		expect(done_line(ended('none: waited on a slow CI run'))).toMatch(
			/52′ {2}🔍 ∅ waited on a slo…$/u,
		)
	})

	it('says `∅ ↻#N` for a recurrence commented on', () => {
		expect(done_line(ended(RECURRED))).toMatch(/52′ {2}🔍 ∅ ↻#4790$/u)
	})

	it('says 💥 for a launch that failed', () => {
		const failed = found_of({ kind: 'failed', issue: DONE, minutes: MINUTES })

		expect(done_line(failed)).toMatch(/52′ {2}🔍 💥$/u)
	})

	it('says 💥 for a session gone without its end note', () => {
		expect(done_line(found_of(STARTED_NOTE))).toMatch(/52′ {2}🔍 💥$/u)
	})
})

describe('run_board_render — a merged row’s spinner', () => {
	it('stands still on 🔍 for a session whose start token was never read', () => {
		const unknown = found_of(STARTED_NOTE, { is_investigating: undefined })

		expect(done_line(unknown, { spinner: SPINNER })).toMatch(/52′ {2}🔍$/u)
	})

	it('turns no spinner once it ended', () => {
		const line = done_line(
			{ ...ended(run_event_overrun.FILED_RESULT), overrun_filed: FILED },
			{ spinner: SPINNER },
		)

		expect(line).toMatch(/52′ {2}🔍 4768, 4769, 4770$/u)
	})
})

// joshuafolkken/kit#4818: the outcome takes its columns from the title, so the row stays one line.
describe('run_board_render — a merged row’s width', () => {
	it('cuts the title so the row fits a narrow pane', () => {
		const found = { ...ended(CI_WAIT), filed: FILED }
		const size = { rows: PANE_ROWS, columns: NARROW }
		const line = run_board_render
			.render({ header: board(found), notes: [], size })
			.map((drawn) => stripVTControlCharacters(drawn))
			.find((drawn) => drawn.includes(String(DONE)))

		expect(run_board_fit.width_of(line ?? '')).toBeLessThanOrEqual(NARROW)
		expect(line).toMatch(/…\s.*52′ {2}4768, 4769, 4770 {2}🔍 ∅ CI wait$/u)
	})
})

// joshuafolkken/kit#4880: the child's own filings come before whatever the investigation came to.
describe('run_board_render — a merged row’s own filings before its outcome', () => {
	it('keeps them before ⏭', () => {
		const skipped = found_of(
			{ kind: 'skipped', issue: DONE, reason: 'no ledger' },
			{ filed: FILED },
		)

		expect(done_line(skipped)).toMatch(/\?′ {2}4768, 4769, 4770 {2}⏭ no ledger$/u)
	})

	it('keeps them before ⏭ no record', () => {
		expect(done_line(found_of(undefined, { filed: FILED }))).toMatch(
			/\?′ {2}4768, 4769, 4770 {2}⏭ no record$/u,
		)
	})

	it('keeps them before 💥', () => {
		const failed = found_of({ kind: 'failed', issue: DONE, minutes: MINUTES }, { filed: FILED })

		expect(done_line(failed)).toMatch(/52′ {2}4768, 4769, 4770 {2}🔍 💥$/u)
	})

	it('says the recurrence after them', () => {
		const line = done_line({ ...ended(RECURRED), filed: FILED })

		expect(line).toMatch(/52′ {2}4768, 4769, 4770 {2}🔍 ∅ ↻#4790$/u)
	})
})

describe('run_board_render — a done row’s filings', () => {
	it('draws each number through the header’s link', () => {
		const line = done_line(found_of(WITHIN, { filed: FILED }), {
			link: (reference) => `<${reference}>`,
		})

		expect(line).toMatch(/18′ {2}<4768>, <4769>, <4770>$/u)
	})

	it('draws only them on a 🏁 done row', () => {
		const status: ItemStatus = { ...MERGED, state: 'done' }
		const line = row_line(board(found_of(undefined, { filed: FILED }), {}, status))

		expect(line).toMatch(/″ +4768, 4769, 4770$/u)
		expect(line).not.toContain('′ ')
	})

	it('draws every filing as one list on a 🏁 done row, whatever its origin', () => {
		const status: ItemStatus = { ...MERGED, state: 'done' }
		const found = found_of(undefined, { filed: ['4768'], overrun_filed: ['4769', '4770'] })
		const line = row_line(board(found, {}, status))

		expect(line).toMatch(/″ +4768, 4769, 4770$/u)
		expect(line).not.toContain(STILL)
	})

	it('draws none on a row still running', () => {
		const status: ItemStatus = { state: 'running', started_ms: STARTED }
		const running = found_of(STARTED_NOTE, { filed: FILED, is_investigating: true })
		const line = row_line(board(running, {}, status))

		expect(line).not.toContain('4768')
		expect(line).not.toContain(STILL)
	})
})

describe('run_board_render — a merged row’s running investigation', () => {
	const running = found_of(STARTED_NOTE, { filed: FILED, is_investigating: true })

	it('ends on the numbers and the spinner where one turns', () => {
		expect(done_line(running, { spinner: SPINNER })).toMatch(/52′ {2}4768, 4769, 4770 {2}⠋$/u)
	})

	it('ends on 🔍 where no spinner turns, and the legend names it', () => {
		const lines = lines_of(board(found_of(STARTED_NOTE, { is_investigating: true })))

		expect(lines.find((line) => line.includes(String(DONE)))).toMatch(/52′ {2}🔍$/u)
		expect(lines.join('\n')).toContain(`${STILL} overrun investigation`)
	})
})
