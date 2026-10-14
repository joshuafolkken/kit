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
const LONG_TITLE = 'Verify josh start end-to-end on a fresh machine with nothing installed'
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
		title: 'Short title',
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

// The line the board draws for the row, in a pane `columns` wide where one is given.
function line_of(row: BoardRow, columns?: number): string {
	const section = row.state === 'running' ? { active: [row] } : { unreached: [row] }
	const board = header({ layout: { ...EMPTY_LAYOUT, ...section } })
	const size = columns === undefined ? undefined : { rows: TALL, columns }
	const lines = run_board_render.render({ header: board, notes: [], size })
	const drawn = lines.map((line) => stripVTControlCharacters(line))

	return drawn.find((line) => line.includes(String(ISSUE))) ?? ''
}

describe('run_board_render.render — why a waiting row waits', () => {
	it('draws the reason at the end of the row', () => {
		expect(line_of(waiting({ reason: UNTRIAGED }))).toMatch(/Short title {2}untriaged$/u)
	})

	it('draws the reason after the row’s blockers, which stay as they were', () => {
		const blocked = waiting({ waits: [BLOCKER] })

		expect(line_of({ ...blocked, reason: UNTRIAGED })).toBe(`${line_of(blocked)}  untriaged`)
		expect(line_of(blocked)).toMatch(/🔗 3409$/u)
	})

	it('draws a lane’s stage with how long the lane has stood at it', () => {
		expect(line_of(waiting({ reason: INSTALLING }))).toMatch(/ {2}installing 0:42$/u)
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
		expect(line_of(waiting({ reason: UNTRIAGED }), NARROW)).toMatch(/Short title {2}untriaged$/u)
	})

	it('draws a row with no reason as it did, in a pane and out of one', () => {
		const wide = line_of(waiting({ title: LONG_TITLE }))

		expect(wide).toContain(`${LONG_TITLE.slice(0, run_board_render.TITLE_LIMIT - 1)}…`)
		expect(line_of(running())).not.toContain('untriaged')
		expect(line_of(running(), NARROW * 2)).toBe(line_of({ ...running(), reason: undefined }))
	})
})
