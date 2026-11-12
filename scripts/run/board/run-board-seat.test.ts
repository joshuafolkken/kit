import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_lanes } from './run-board-render-lanes'
import { run_board_render_section } from './run-board-render-section'
import { run_board_seat } from './run-board-seat'

// joshuafolkken/kit#6538: each lane seat no lane holds says why, drawn under the lanes rule.

const { EMPTY_LAYOUT, header, lines_of } = run_board_render_fixture
const { NO_CANDIDATE, read_of } = run_board_seat
const { WAIT_ICONS } = run_board_labels
const AT = '2026-10-08T09:00:00.000Z'
const FAILED = 6242
const DETAIL = 'lane:open refused: unreadable .env'
const REFUSAL = {
	pos: 2,
	at: AT,
	kind: 'setup',
	text: `no child launched #${String(FAILED)}: ${DETAIL}`,
}
const LAUNCH = { pos: 3, at: AT, kind: 'child-launch', text: '#6243 a' }
const HOLD = 'offer:wait:blocked'
const HOLD_TEXT = 'every queued issue is blocked'
const LIMIT = 3
const NARROW = 40
// A pane short enough that the seat lines give way.
const SHORT = 6
const SEAT = '💺'

function queued_row(extra: Partial<BoardRow> = {}): BoardRow {
	return {
		number: 6529,
		title: 'queued',
		kind: undefined,
		state: 'waiting',
		status: undefined,
		waits: [],
		...extra,
	}
}

function queued(rows: ReadonlyArray<BoardRow>): BoardLayout {
	return { ...EMPTY_LAYOUT, queued: rows.map((row) => ({ kind: 'row', row })) }
}

function seats_of(extra: Partial<BoardHeader>): Array<string> {
	return lines_of(header({ lane_limit: LIMIT, occupied_count: 1, ...extra })).filter((line) =>
		line.includes(SEAT),
	)
}

describe('run_board_seat.read_of', () => {
	it('names the newest launch’s refusal, its issue and the failing step’s words', () => {
		expect(read_of([LAUNCH, { ...REFUSAL, pos: 4 }], HOLD)).toStrictEqual({
			refusal: `#${String(FAILED)}: ${DETAIL}`,
			hold: HOLD,
		})
	})

	it('drops the refusal once a later launch supersedes it', () => {
		expect(read_of([REFUSAL, LAUNCH], undefined)).toStrictEqual({
			refusal: undefined,
			hold: undefined,
		})
	})
})

describe('run_board_render the empty lane seats', () => {
	it('names the failed launch on the first empty seat, its lane and its cause', () => {
		const seats = seats_of({ seats: read_of([REFUSAL], undefined), layout: queued([]) })

		expect(seats).toHaveLength(2)
		expect(seats[0]).toContain(`blocked: #${String(FAILED)}: ${DETAIL}`)
		expect(seats[1]).toContain(NO_CANDIDATE)
	})

	it('says no issue is ready, with the hold as a sentence, when every queued row waits on a blocker', () => {
		const layout = queued([
			queued_row({ waits: ['#1'] }),
			queued_row({ reason: { icon: WAIT_ICONS.held } }),
		])
		const seats = seats_of({ seats: read_of([], HOLD), layout })

		expect(seats).toStrictEqual(
			Array.from({ length: 2 }, () => expect.stringContaining(`${NO_CANDIDATE} — ${HOLD_TEXT}`)),
		)
	})

	it('counts no stalled or needs-decision row as a candidate: the driver offers neither', () => {
		const layout = queued([queued_row({ state: 'stopped' }), queued_row({ state: 'human' })])

		expect(seats_of({ seats: read_of([], undefined), layout })).toStrictEqual(
			Array.from({ length: 2 }, () => expect.stringContaining(NO_CANDIDATE)),
		)
	})

	it('draws no seat line where the seats are unread', () => {
		expect(seats_of({ seats: undefined, layout: queued([]) })).toStrictEqual([])
	})

	it('updates once a candidate appears: a row waiting only for a lane takes the seat', () => {
		const layout = queued([queued_row({ reason: { icon: WAIT_ICONS.lane, value: '1/3' } })])

		expect(seats_of({ seats: read_of([], undefined), layout })).toStrictEqual([])
		expect(seats_of({ seats: read_of([], HOLD), layout })[0]).toContain(`held — ${HOLD_TEXT}`)
	})
})

// joshuafolkken/kit#7287: the seat line says who fills the seat, never the ledger code.
describe('run_board_seat a hold as a sentence', () => {
	it('names your triage for a judge hand-back', () => {
		const seats = seats_of({ seats: read_of([], 'hand-back:judge'), layout: queued([]) })

		expect(seats[0]).toContain('💺 no issue ready to start — open issues await your triage')
		expect(seats[0]).not.toContain('hand-back')
	})
})

describe('run_board_render the empty lane seats’ room', () => {
	it('draws the lanes rule and the seats when no lane is open', () => {
		const lines = lines_of(
			header({ lane_limit: LIMIT, occupied_count: 0, seats: read_of([], undefined) }),
		)

		expect(lines.join('\n')).toContain('🧵 lanes 0/3')
		expect(lines.filter((line) => line.includes(NO_CANDIDATE))).toHaveLength(LIMIT)
	})

	it.each([
		{ name: 'every seat is held', extra: { occupied_count: LIMIT } },
		{ name: 'the capacity is unread', extra: { lane_limit: undefined } },
		{ name: 'a single run is drawn', extra: { run_name: 'fullrun #6538' } },
	])('draws no seat line when $name', ({ extra }) => {
		expect(seats_of({ seats: read_of([REFUSAL], undefined), ...extra })).toStrictEqual([])
	})
})

describe('run_board_render the empty lane seats’ count and width', () => {
	it('counts no seat line as a lane row, folded or cut', () => {
		const board = header({ lane_limit: LIMIT, occupied_count: 0, seats: read_of([], undefined) })
		const [section] = run_board_render_lanes.lanes_section([], undefined, board)
		const lines = run_board_render
			.render({ header: board, notes: [], size: { columns: 80, rows: SHORT } })
			.map((line) => stripVTControlCharacters(line))

		expect(run_board_render_section.row_count(section?.lines ?? [])).toBe(0)
		expect(lines.filter((line) => line.includes(SEAT)).length).toBeLessThan(LIMIT)
		expect(lines.join('\n')).not.toMatch(/more \d/u)
	})

	it('keeps each seat line within a narrow pane', () => {
		const board = header({
			lane_limit: LIMIT,
			occupied_count: 1,
			seats: read_of([REFUSAL], undefined),
		})
		const lines = run_board_render
			.render({ header: board, notes: [], size: { columns: NARROW, rows: 50 } })
			.map((line) => stripVTControlCharacters(line))
		const seats = lines.filter((line) => line.includes(SEAT))

		expect(seats).toHaveLength(2)
		for (const line of seats) expect(run_board_fit.width_of(line)).toBeLessThanOrEqual(NARROW)
	})
})
