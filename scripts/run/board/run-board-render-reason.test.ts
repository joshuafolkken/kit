import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardRow, RowReason } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#3750: a waiting row says why it waits after its blockers, a lane being opened says
// its stage and how long it has stood there, and a narrow pane cuts the title rather than the reason.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header } = run_board_render_fixture
const SECOND = 1000
const ISSUE = 3720
const BLOCKER = '3409'
const SHORT_TITLE = 'Short title'
const LONG_TITLE = 'Verify josh start end-to-end on a fresh machine with nothing installed'
const MIDDLE_TITLE = 'A title of about thirty chars!'
const TITLE_START = 'Verify j'
const UNTRIAGED: RowReason = { text: 'untriaged' }
const STAGE_SECONDS = 42
const INSTALLING: RowReason = { text: 'installing', since_ms: NOW - STAGE_SECONDS * SECOND }
const NARROW = 40
const TALL = 100
const JAPANESE = /[぀-ヿ一-鿿]/u

function waiting(extra: Partial<BoardRow> = {}): BoardRow {
	return {
		number: ISSUE,
		title: SHORT_TITLE,
		kind: undefined,
		state: 'waiting',
		status: undefined,
		waits: [],
		...extra,
	}
}

function running(): BoardRow {
	const status = { state: 'running' as const, started_ms: STARTED + MINUTE }

	return { ...waiting({ title: LONG_TITLE }), state: 'running', status }
}

// The lines the board draws for the rows, in a pane `columns` wide where one is given.
function lines_of(rows: ReadonlyArray<BoardRow>, columns?: number): Array<string> {
	const active = rows.filter((row) => row.state === 'running')
	const unreached = rows.filter((row) => row.state !== 'running')
	const board = header({ layout: { ...EMPTY_LAYOUT, active, unreached } })
	const size = columns === undefined ? undefined : { rows: TALL, columns }
	const lines = run_board_render.render({ header: board, notes: [], size })

	return lines.map((line) => stripVTControlCharacters(line))
}

// The line the board draws for the issue's row, in a pane `columns` wide where one is given.
function line_of(row: BoardRow, columns?: number): string {
	return lines_of([row], columns).find((line) => line.includes(String(ISSUE))) ?? ''
}

describe('run_board_render.render — why a waiting row waits', () => {
	it('draws the reason two blanks after the title, not past the title column', () => {
		const line = line_of(waiting({ reason: UNTRIAGED }))
		const title_column = line.indexOf(SHORT_TITLE)

		expect(line).toMatch(/Short title {2}untriaged$/u)
		expect(line.indexOf('untriaged')).toBe(title_column + SHORT_TITLE.length + 2)
	})

	it('draws the blockers right after the title, and the reason after them', () => {
		const line = line_of(waiting({ waits: [BLOCKER], reason: UNTRIAGED }))

		expect(line).toMatch(/Short title {2}🔗 3409 {2}untriaged$/u)
	})

	it('keeps a running row’s columns where they are beside a waiting row', () => {
		const other = waiting({ number: ISSUE + 1, reason: UNTRIAGED })
		const [alone, beside] = [[running()], [running(), other]].map((rows) =>
			lines_of(rows).find((line) => line.includes(` ${String(ISSUE)} `)),
		)

		expect(beside).toBe(alone)
	})

	it('draws the reason after the row’s blockers, which stay as they were', () => {
		const blocked = waiting({ waits: [BLOCKER] })

		expect(line_of({ ...blocked, reason: UNTRIAGED })).toBe(`${line_of(blocked)}  untriaged`)
		expect(line_of(blocked)).toMatch(/🔗 3409$/u)
	})

	it('draws a lane’s stage with how long the lane has stood at it', () => {
		expect(line_of(waiting({ reason: INSTALLING }))).toMatch(/ {2}installing 42″$/u)
	})

	it('draws no Japanese in what it adds to the row', () => {
		const added = [UNTRIAGED, INSTALLING].map((reason) => line_of(waiting({ reason })))

		expect(added.join('\n')).not.toMatch(JAPANESE)
	})
})

describe('run_board_render.render — a reason in a narrow pane', () => {
	it('cuts the title to keep the reason on the row’s one line', () => {
		const line = line_of(waiting({ title: LONG_TITLE, reason: UNTRIAGED }), NARROW)

		expect(line).toMatch(/… {2}untriaged$/u)
		expect(run_board_fit.width_of(line)).toBeLessThanOrEqual(NARROW)
	})

	it('never cuts the title under what tells two rows apart', () => {
		const reason = { text: 'overlaps 3701 (scripts/run/board/run-board-render.ts)' }
		const line = line_of(waiting({ title: LONG_TITLE, reason }), NARROW)

		expect(line).toContain(` ${TITLE_START.slice(0, -1)}…  overlaps 3701`)
	})

	it('leaves a title that already fits the pane whole', () => {
		const line = line_of(waiting({ reason: UNTRIAGED }), NARROW)

		expect(line).toMatch(/Short title {2}untriaged$/u)
		expect(run_board_fit.width_of(line)).toBeLessThanOrEqual(NARROW)
	})

	it('cuts a title shorter than the title column by just the columns the line runs over', () => {
		const line = line_of(waiting({ title: MIDDLE_TITLE, reason: UNTRIAGED }), NARROW)

		expect(line).toMatch(/… {2}untriaged$/u)
		expect(run_board_fit.width_of(line)).toBe(NARROW)
	})

	it('draws a row with no reason as it did, in a pane and out of one', () => {
		const wide = line_of(waiting({ title: LONG_TITLE }))

		expect(wide).toContain(`${LONG_TITLE.slice(0, run_board_render.TITLE_LIMIT - 1)}…`)
		expect(line_of(running())).not.toContain('untriaged')
		expect(line_of(running(), NARROW * 2)).toBe(line_of({ ...running(), reason: undefined }))
	})
})

// joshuafolkken/kit#4045: a parked row says why it ended where a waiting row says why it waits; its
// title is padded to the title column, so it gives up just the columns the line runs over.
describe('run_board_render.render — why a parked row ended', () => {
	const status = { state: 'parked' as const, started_ms: STARTED + MINUTE }
	const parked: BoardRow = { ...waiting({ title: MIDDLE_TITLE }), state: 'parked', status }
	// The columns the pane is narrowed by, fewer than the title column pads a short title with.
	const OVERRUN = 5

	it('draws the reason after the row’s padded columns, which stay as they were', () => {
		const line = line_of({ ...parked, reason: UNTRIAGED })

		expect(line.startsWith(line_of(parked))).toBe(true)
		expect(line).toMatch(/ {2}untriaged$/u)
	})

	it('cuts the padded title by just the columns the line runs over', () => {
		const reasoned = { ...parked, reason: UNTRIAGED }
		const columns = run_board_fit.width_of(line_of(reasoned)) - OVERRUN
		const line = line_of(reasoned, columns)

		expect(line).toMatch(/ {2}untriaged$/u)
		expect(run_board_fit.width_of(line)).toBe(columns)
	})
})
