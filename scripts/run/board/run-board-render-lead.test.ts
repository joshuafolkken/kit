import { stripVTControlCharacters } from 'node:util'
import type { BudgetWait } from '#scripts/gate/core-wait'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_lead } from './run-board-render-lead'

// joshuafolkken/kit#4292: a lane row leads with its progress, its phase's icon, the phase's time and
// the run's time, each in a column of its own, so a held, a running and a stopped row line up and the
// cells after them start where the processes rows' do.

const { EMPTY_LAYOUT, MINUTE, NOW, header } = run_board_render_fixture
const { ELAPSED_START, LANE_INDENT, TIME_WIDTH, USAGE_START, lead_of } = run_board_render_lead
const LANE = 4267
const SPINNER = '⠧'
const SECOND = 1000
const HOUR = 60 * MINUTE

function lane(state: BoardRow['state'] = 'running'): BoardRow {
	const status = {
		state,
		started_ms: NOW - 20 * MINUTE,
		track: ['gate' as const],
		phase_ms: NOW - 2 * MINUTE,
	}

	return { number: LANE, title: 'Lane', kind: undefined, state, status, waits: [] }
}

// A running lane past ten hours at its phase and in all: `10°05′40″` and `17°03′34″` drawn in full
// would take nine columns.
function long_lane(): BoardRow {
	const row = lane()
	const started_ms = NOW - (17 * HOUR + 3 * MINUTE + 34 * SECOND)
	const phase_ms = NOW - (10 * HOUR + 5 * MINUTE + 40 * SECOND)

	return { ...row, status: { ...row.status, state: row.state, started_ms, phase_ms } }
}

function wait(extra: Partial<BudgetWait> = {}): BudgetWait {
	return {
		command: 'gate test',
		lane: String(LANE),
		elsewhere: undefined,
		waited_ms: 43 * SECOND,
		reason: 'cores',
		...extra,
	}
}

function board(row: BoardRow, waits: ReadonlyArray<BudgetWait> = []): BoardHeader {
	const layout = { ...EMPTY_LAYOUT, active: [row] }

	return header({ layout, budget_waits: waits, spinner: SPINNER })
}

function lead(row: BoardRow, waits: ReadonlyArray<BudgetWait> = []): string {
	return stripVTControlCharacters(lead_of(row, board(row, waits)))
}

function width(text: string): number {
	return run_board_fit.width_of(`${LANE_INDENT}${text}`)
}

describe('run_board_render_lead.lead_of', () => {
	it('turns the spinner in the progress column of a running row', () => {
		expect(lead(lane())).toBe(`${SPINNER}  🚦    2′00″   20′00″`)
	})

	it('draws 🚧 in the progress column and the hold in the run time’s column while held', () => {
		expect(lead(lane(), [wait()])).toBe('🚧 🚦    2′00″ 💪   43″')
		expect(lead(lane(), [wait({ reason: 'memory', waited_ms: 65 * SECOND })])).toBe(
			'🚧 🚦    2′00″ 🧠 1′05″',
		)
	})

	it('blanks the progress column of a stopped row', () => {
		expect(lead(lane('stopped')).startsWith(' '.repeat(3))).toBe(true)
	})
})

// joshuafolkken/kit#7710: a single run a stop ended — the 🏠 row, or its own board's — leads with ✅
// and draws no phase icon; a lane's stopped row keeps its blanks.
describe('run_board_render_lead.lead_of — a stopped single run', () => {
	it('draws ✅ and no phase icon on a stopped single run’s row', () => {
		const row = lane('stopped')
		const root = header({ layout: { ...EMPTY_LAYOUT, singles: [{ name: 'halfrun', row }] } })
		const own = header({ ...board(row), run_name: 'halfrun', ended_ms: NOW })

		for (const view of [root, own]) {
			const text = stripVTControlCharacters(lead_of(row, view))

			expect(text.startsWith('✅    ')).toBe(true)
			expect(width(text)).toBe(USAGE_START - 1)
		}
	})
})

describe('run_board_render_lead.lead_of — columns', () => {
	it('ends every lead where the usage cells start less one blank', () => {
		const leads = [lead(lane()), lead(lane(), [wait()]), lead(lane('stopped')), lead(long_lane())]

		expect(leads.map((text) => width(text))).toStrictEqual([
			USAGE_START - 1,
			USAGE_START - 1,
			USAGE_START - 1,
			USAGE_START - 1,
		])
	})

	// joshuafolkken/kit#8481: a time of ten hours and more drops its seconds rather than pushing the
	// columns after it right.
	it('draws a phase and a run of ten hours and more without their seconds, in the same columns', () => {
		const text = lead(long_lane())

		expect(text).toBe(`${SPINNER}  🚦   10°05′   17°03′`)
		expect(width(text)).toBe(USAGE_START - 1)
	})

	// joshuafolkken/kit#7866: a lane row draws its time net of the host's sleep, without the bracket,
	// so its usage cells still start where the processes rows' do.
	it('draws a lane row’s time net of a sleep, in the same columns', () => {
		const row = lane()
		const gaps = [{ from_ms: NOW - 15 * MINUTE, to_ms: NOW - 5 * MINUTE }]
		const text = lead({ ...row, status: { ...row.status, state: row.state, gaps } })

		expect(text).toBe(`${SPINNER}  🚦    2′00″   10′00″`)
		expect(width(text)).toBe(USAGE_START - 1)
	})

	// joshuafolkken/kit#8257: the spinner and two blanks put the icon where every section's row starts.
	it('stands the phase icon in the shared row indent’s column', () => {
		const text = lead(lane())
		const before = text.slice(0, text.indexOf('🚦'))

		expect(width(before)).toBe(run_board_fit.ROW_INDENT.length)
	})

	it('starts the run’s time at the column the rule’s ⏰ stands over', () => {
		const before = lead(lane()).slice(0, -TIME_WIDTH)

		expect(width(before)).toBe(ELAPSED_START)
	})
})
