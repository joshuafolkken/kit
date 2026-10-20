import { stripVTControlCharacters } from 'node:util'
import { run_stalled } from '#scripts/run/park/run-stalled'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardRow, RowReason } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#3750: a waiting row says why it waits after its blockers, a lane being opened says
// its stage and how long it has stood there, and a narrow pane cuts the title rather than the reason.
// joshuafolkken/kit#4288: a waiting row leads with its wait's icon and condition column; only what
// is too long for the column follows its title.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, board_usage, header } = run_board_render_fixture
const SECOND = 1000
const ISSUE = 3720
const BLOCKER = '3409'
const OTHER_BLOCKER = '3410'
const HOLDER = '3701'
const SHORT_TITLE = 'Short title'
const LONG_TITLE = 'Verify josh start end-to-end on a fresh machine with nothing installed'
const MIDDLE_TITLE = 'A title of about thirty chars!'
const TITLE_START = 'Verify j'
const PATH = 'package.json'
const HELD: RowReason = { icon: '📂', issues: [HOLDER], tail: PATH }
const ENDING = 'superseded'
const ENDED_REASON: RowReason = { tail: ENDING }
const STAGE_SECONDS = 42
const INSTALLING: RowReason = { icon: '📥', since_ms: NOW - STAGE_SECONDS * SECOND }
// A pane the condition column's 12 columns (joshuafolkken/kit#4288) leave 40 in.
const NARROW = 52
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
	it('draws the tail two blanks after the title, not past the title column', () => {
		const line = line_of(waiting({ reason: HELD }))
		const title_column = line.indexOf(SHORT_TITLE)

		expect(line).toMatch(/^ {2}📂 3701 {8}3720 {4}Short title {2}package\.json$/u)
		expect(line.indexOf(PATH)).toBe(title_column + SHORT_TITLE.length + 2)
	})

	it('draws the first blocker in the condition column and the rest after the title', () => {
		const waits = [BLOCKER, OTHER_BLOCKER]
		const line = line_of(waiting({ waits, reason: { icon: '🔗', issues: waits } }))

		expect(line).toMatch(/^ {2}🔗 3409\+1 {6}3720 {4}Short title {2}3410$/u)
	})

	it('keeps a running row’s columns where they are beside a waiting row', () => {
		const other = waiting({ number: ISSUE + 1, reason: HELD })
		const [alone, beside] = [[running()], [running(), other]].map((rows) =>
			lines_of(rows).find((line) => line.includes(` ${String(ISSUE)} `)),
		)

		expect(beside).toBe(alone)
	})

	it('draws the tail after what the row draws without one, which stays as it was', () => {
		const bare = waiting({ reason: { ...HELD, tail: undefined } })

		expect(line_of(waiting({ reason: HELD }))).toBe(`${line_of(bare)}  ${PATH}`)
	})

	it('draws a lane’s stage with how long the lane has stood at it before the number', () => {
		expect(line_of(waiting({ reason: INSTALLING }))).toMatch(/^ {2}📥 42″ {9}3720 {4}Short title$/u)
	})

	it('draws no Japanese in what it adds to the row', () => {
		const added = [HELD, INSTALLING].map((reason) => line_of(waiting({ reason })))

		expect(added.join('\n')).not.toMatch(JAPANESE)
	})
})

describe('run_board_render.render — a reason in a narrow pane', () => {
	it('cuts the title to keep the reason on the row’s one line', () => {
		const line = line_of(waiting({ title: LONG_TITLE, reason: HELD }), NARROW)

		expect(line).toMatch(/… {2}package\.json$/u)
		expect(run_board_fit.width_of(line)).toBeLessThanOrEqual(NARROW)
	})

	it('never cuts the title under what tells two rows apart', () => {
		const reason = { ...HELD, tail: 'scripts/run/board/run-board-render.ts' }
		const line = line_of(waiting({ title: LONG_TITLE, reason }), NARROW)

		expect(line).toContain(` ${TITLE_START.slice(0, -1)}…  scripts/run`)
	})

	it('leaves a title that already fits the pane whole', () => {
		const line = line_of(waiting({ reason: ENDED_REASON }), NARROW)

		expect(line).toMatch(/Short title {2}superseded$/u)
		expect(run_board_fit.width_of(line)).toBeLessThanOrEqual(NARROW)
	})

	it('cuts a title shorter than the title column by just the columns the line runs over', () => {
		const line = line_of(waiting({ title: MIDDLE_TITLE, reason: HELD }), NARROW)

		expect(line).toMatch(/… {2}package\.json$/u)
		expect(run_board_fit.width_of(line)).toBe(NARROW)
	})

	it('draws a row with no reason as it did, in a pane and out of one', () => {
		const wide = line_of(waiting({ title: LONG_TITLE }))

		expect(wide).toContain(`${LONG_TITLE.slice(0, run_board_render.TITLE_LIMIT - 1)}…`)
		expect(line_of(running())).not.toContain(PATH)
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
		const line = line_of({ ...parked, reason: ENDED_REASON })

		expect(line.startsWith(line_of(parked))).toBe(true)
		expect(line).toMatch(/ {2}superseded$/u)
	})

	it('cuts the padded title by just the columns the line runs over', () => {
		const reasoned = { ...parked, reason: ENDED_REASON }
		const columns = run_board_fit.width_of(line_of(reasoned)) - OVERRUN
		const line = line_of(reasoned, columns)

		expect(line).toMatch(/ {2}superseded$/u)
		expect(run_board_fit.width_of(line)).toBe(columns)
	})
})

// joshuafolkken/kit#4060: a parked row draws no usage and no finish time, so its reason follows its
// time; a reason the floored title still runs past the pane with is cut to an ellipsis.
const ENDED = { started_ms: STARTED + MINUTE, ended_ms: NOW - MINUTE }
const WORDY: RowReason = {
	tail: `the sandbox approach breaks pnpm store access; ${'x'.repeat(NARROW)}`,
}
const NO_USAGE = board_usage(new Map())
const parked: BoardRow = {
	...waiting({ reason: ENDED_REASON }),
	state: 'parked',
	status: { state: 'parked', ...ENDED },
}
const withdrawn: BoardRow = {
	...waiting({ number: ISSUE + 1, title: LONG_TITLE, reason: WORDY }),
	state: 'withdrawn',
	status: { state: 'withdrawn', ...ENDED },
}

// The parked row's line on a board whose usage column a withdrawn row's finish time draws.
function parked_line(): string {
	const layout = { ...EMPTY_LAYOUT, unreached: [parked, withdrawn] }
	const lines = run_board_render.render({ header: header({ layout, usages: NO_USAGE }), notes: [] })
	const line = lines.find((drawn) => drawn.includes(` ${String(ISSUE)} `)) ?? ''

	return stripVTControlCharacters(line)
}

describe('run_board_render.render — a parked row’s reason, and a reason cut to the pane', () => {
	it('draws a parked row’s reason two columns after its time', () => {
		expect(parked_line()).toMatch(/\d″ {2}superseded$/u)
	})

	it('cuts a withdrawn row’s reason to an ellipsis once its title is at the floor', () => {
		const line = line_of({ ...withdrawn, number: ISSUE }, NARROW * 2)

		expect(line).toContain(` ${TITLE_START.slice(0, -1)}… `)
		expect(line.endsWith('…')).toBe(true)
		expect(run_board_fit.width_of(line)).toBe(NARROW * 2)
	})

	it('cuts a waiting row’s reason by the same rule', () => {
		const line = line_of(waiting({ title: LONG_TITLE, reason: WORDY }), NARROW)

		expect(line).toContain(` ${TITLE_START.slice(0, -1)}…  the sandbox`)
		expect(line.endsWith('…')).toBe(true)
		expect(run_board_fit.width_of(line)).toBe(NARROW)
	})

	it('draws the whole reason where no pane width is known', () => {
		expect(line_of({ ...withdrawn, number: ISSUE })).toMatch(
			new RegExp(`${'x'.repeat(NARROW)}$`, 'u'),
		)
	})
})

// joshuafolkken/kit#4215: a stalled row names its cause and the action that resumes it, which a narrow
// pane keeps by cutting the title first.
describe('run_board_render.render — a stalled row’s cause and resume action', () => {
	const STALLED: RowReason = { tail: run_stalled.row_text(ISSUE, 'review failed') }
	const stalled: BoardRow = {
		...waiting({ title: LONG_TITLE, reason: STALLED }),
		state: 'stopped',
		status: { state: 'stopped', ...ENDED },
	}

	it('cuts the title first to keep the cause and the action whole', () => {
		const line = line_of(stalled, NARROW * 2)

		expect(line).toContain(TITLE_START)
		expect(line).toMatch(/… {2}.* {2}review failed → fullrun #3720$/u)
		expect(run_board_fit.width_of(line)).toBeLessThanOrEqual(NARROW * 2)
	})

	it('cuts the reason to an ellipsis once the title is at the floor', () => {
		const line = line_of(stalled, NARROW)

		expect(line).toContain(` ${TITLE_START.slice(0, -1)}… `)
		expect(line.endsWith('…')).toBe(true)
		expect(run_board_fit.width_of(line)).toBe(NARROW)
	})
})
