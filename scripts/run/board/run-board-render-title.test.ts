import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardRow, RowReason } from './run-board-layout'
import { run_board_pause } from './run-board-pause'
import { run_board_render_title, type RowCut } from './run-board-render-title'

const { ELLIPSIS, TITLE_LIMIT, WHOLE, fitted, fitted_limit, reason_text, title_of } =
	run_board_render_title

const SECOND = 1000
const NOW = 1_000_000
const STAGE_SECONDS = 42
const LONG_TITLE = 'Verify josh start end-to-end on a fresh machine with nothing installed'
const SHORT_TITLE = 'Short title'
const TAIL = 'untriaged'
const UNTRIAGED: RowReason = { tail: TAIL }
// joshuafolkken/kit#4288: a stage's time is the condition column's, never what follows the title.
const INSTALLING: RowReason = { icon: '📥', since_ms: NOW - STAGE_SECONDS * SECOND }
const OVERRUN = 8
const TINY_PANE = 10
const REASON_CUT = 4
// A pane a title cut to nothing leaves room in for only part of a reason: `TAIL`'s but `REASON_CUT`.
const FLOOR_PANE = TAIL.length - REASON_CUT
// Six characters taking two columns each.
const WIDE_REASON = '理由を書いた'
const PAUSE_TAIL = 'answer the decision, then run pnpm josh backlog:triage --adopt 2'
const EVIDENCE_URL = 'https://github.com/joshuafolkken/kit/issues/1#issuecomment-2'
// A pane every row's whole line fits in.
const WIDE_PANE = 400

function row_of(extra: Partial<BoardRow> = {}): BoardRow {
	return {
		number: 1,
		title: LONG_TITLE,
		kind: undefined,
		state: 'waiting',
		status: undefined,
		waits: [],
		...extra,
	}
}

// A row's line as a renderer would draw it: its title at the limit, then its reason with its cut — the
// blank between them left out with a title cut to nothing.
function draw_of(row: BoardRow): (cut: RowCut) => string {
	return function draw({ title_limit, reason_cut }: RowCut): string {
		const parts = [title_of(row.title, title_limit), reason_text(row, reason_cut) ?? '']

		return parts.filter((part) => part !== '').join(' ')
	}
}

function fitted_in(row: BoardRow, columns: number | undefined): string {
	return fitted(row, columns, draw_of(row))
}

// The pane the row's full-title line runs `OVERRUN` columns past.
function pane_of(row: BoardRow): number {
	return run_board_fit.width_of(draw_of(row)(WHOLE)) - OVERRUN
}

describe('run_board_render_title.title_of', () => {
	it('leaves a title within the limit whole', () => {
		expect(title_of(SHORT_TITLE)).toBe(SHORT_TITLE)
	})

	it('cuts a longer title to the limit, ending in an ellipsis', () => {
		const cut = title_of(LONG_TITLE)

		expect(cut).toHaveLength(TITLE_LIMIT)
		expect(cut.endsWith(ELLIPSIS)).toBe(true)
	})

	it('draws a missing title as nothing', () => {
		expect(title_of()).toBe('')
	})

	it('draws a title cut to no column as nothing (joshuafolkken/kit#8990)', () => {
		expect(title_of(LONG_TITLE, 0)).toBe('')
	})
})

describe('run_board_render_title.reason_text', () => {
	it('says nothing for a row with no reason', () => {
		expect(reason_text(row_of())).toBeUndefined()
	})

	it('says the reason’s tail as it is', () => {
		expect(reason_text(row_of({ reason: UNTRIAGED }))).toBe(TAIL)
	})

	it('says nothing after the title of a stage, whose time the condition column draws', () => {
		expect(reason_text(row_of({ reason: INSTALLING }))).toBeUndefined()
	})

	it('gives up the cut columns at the reason end, ending on an ellipsis', () => {
		// The ellipsis takes one of the columns left.
		const kept = TAIL.slice(0, TAIL.length - REASON_CUT - ELLIPSIS.length)

		expect(reason_text(row_of({ reason: UNTRIAGED }), REASON_CUT)).toBe(`${kept}${ELLIPSIS}`)
	})

	it('cuts a wide-character reason by the columns it takes, not its characters', () => {
		const row = row_of({ reason: { tail: WIDE_REASON } })
		const cut = reason_text(row, REASON_CUT) ?? ''

		expect(cut).toBe(`理由を${ELLIPSIS}`)
		expect(run_board_fit.width_of(cut)).toBeLessThanOrEqual(
			run_board_fit.width_of(WIDE_REASON) - REASON_CUT,
		)
	})

	it('leaves only the ellipsis for a cut at or past the reason length', () => {
		expect(reason_text(row_of({ reason: UNTRIAGED }), TAIL.length)).toBe(ELLIPSIS)
	})
})

describe('run_board_render_title.fitted', () => {
	it('gives up exactly the columns the line runs past the pane', () => {
		const row = row_of({ reason: UNTRIAGED })
		const columns = pane_of(row)

		expect(run_board_fit.width_of(fitted_in(row, columns))).toBe(columns)
	})

	// joshuafolkken/kit#8990: the title floor is none.
	it('cuts the title to nothing before the reason, and cuts the reason for the rest', () => {
		const row = row_of({ reason: UNTRIAGED })
		const line = fitted_in(row, FLOOR_PANE)

		expect(line).toBe(reason_text(row, REASON_CUT))
		expect(run_board_fit.width_of(line)).toBe(FLOOR_PANE)
	})

	it('draws the reason whole where the title cut to nothing leaves it room', () => {
		const row = row_of({ reason: UNTRIAGED })

		expect(fitted_in(row, TAIL.length)).toBe(TAIL)
	})

	// joshuafolkken/kit#4099: a waiting row the run filed leads its title, not padded, with ✚.
	it('gives up exactly the overrun on a waiting row whose title cell has a lead', () => {
		const lead = '✚ '
		const row = row_of({ title: 'A waiting title under the limit', reason: UNTRIAGED })

		function draw({ title_limit, reason_cut }: RowCut): string {
			const title = title_of(row.title, title_limit - lead.length)

			return `${lead}${title} ${reason_text(row, reason_cut) ?? ''}`
		}

		const columns = run_board_fit.width_of(draw(WHOLE)) - OVERRUN

		expect(run_board_fit.width_of(fitted(row, columns, draw, { lead: lead.length }))).toBe(columns)
	})

	it('leaves a row with no reason at the title column', () => {
		const row = row_of()

		expect(fitted_in(row, TINY_PANE)).toBe(draw_of(row)(WHOLE))
	})

	it('leaves a line that is not kept within a pane at the title column', () => {
		const row = row_of({ reason: UNTRIAGED })

		expect(fitted_in(row, undefined)).toBe(draw_of(row)(WHOLE))
	})
})

// joshuafolkken/kit#7849: a parked row's recorded reason names its next action, so its title gives way.
describe('run_board_render_title.fitted on a parked row with a linked reason', () => {
	const linked: RowReason = { tail: PAUSE_TAIL, evidence_url: EVIDENCE_URL }

	it('cuts the title first and keeps the whole reason on a narrow pane', () => {
		const row = row_of({ state: 'parked', reason: linked })
		const line = fitted_in(row, pane_of(row))

		expect(line).toBe(`${title_of(LONG_TITLE, TITLE_LIMIT - OVERRUN)} ${PAUSE_TAIL}`)
	})

	it('keeps the whole reason past a title cut to nothing, leaving the line to wrap', () => {
		const row = row_of({ state: 'parked', reason: linked })

		expect(fitted_in(row, FLOOR_PANE)).toBe(PAUSE_TAIL)
	})

	it('draws the whole line on a wide pane', () => {
		const row = row_of({ state: 'parked', reason: linked })

		expect(fitted_in(row, WIDE_PANE)).toBe(draw_of(row)(WHOLE))
	})

	it('still cuts the fallback reason at its end', () => {
		const row = row_of({ state: 'parked', reason: { ...linked, tail: run_board_pause.FALLBACK } })
		const line = fitted_in(row, FLOOR_PANE)

		expect(line.startsWith(run_board_pause.FALLBACK.slice(0, 1))).toBe(true)
		expect(line.endsWith(ELLIPSIS)).toBe(true)
		expect(run_board_fit.width_of(line)).toBe(FLOOR_PANE)
	})

	it('still cuts a linked reason at its end on a row that is not parked', () => {
		const row = row_of({ state: 'stopped', reason: linked })
		const line = fitted_in(row, FLOOR_PANE)

		expect(line.endsWith(ELLIPSIS)).toBe(true)
		expect(run_board_fit.width_of(line)).toBe(FLOOR_PANE)
	})
})

// joshuafolkken/kit#8590: a section whose title column is narrower than `TITLE_LIMIT`, the decision
// rows' as wide as their widest title.
const SECTION_LIMIT = 20
const SHARED = 5
// A section of short titles, its title column narrower than its rows give up.
const TINY_LIMIT = 4

describe('run_board_render_title.fitted at a section title column', () => {
	it('draws a whole row at the section title column (ac-fb1412e6)', () => {
		const row = row_of({ state: 'human', reason: UNTRIAGED })
		const whole = draw_of(row)({ title_limit: SECTION_LIMIT, reason_cut: 0 })

		expect(fitted(row, WIDE_PANE, draw_of(row), { limit: SECTION_LIMIT })).toBe(whole)
	})

	it('narrows the title from the section title column (ac-fb1412e6)', () => {
		const row = row_of({ state: 'human', reason: UNTRIAGED })
		const fit = { limit: SECTION_LIMIT, shared: SHARED }

		expect(fitted_limit(row, WIDE_PANE, draw_of(row), fit)).toBe(SECTION_LIMIT - SHARED)
	})

	it('cuts a section title column narrower than its rows give up to nothing (joshuafolkken/kit#8990)', () => {
		const row = row_of({ state: 'human', title: 'Tiny', reason: UNTRIAGED })
		const fit = { limit: TINY_LIMIT, shared: SHARED }

		expect(fitted_limit(row, WIDE_PANE, draw_of(row), fit)).toBe(0)
	})

	it('never widens a title past its section title column', () => {
		const row = row_of({ state: 'human', title: 'Tiny', reason: UNTRIAGED })

		expect(fitted_limit(row, WIDE_PANE, draw_of(row), { limit: TINY_LIMIT, shared: 1 })).toBe(
			TINY_LIMIT - 1,
		)
	})
})
