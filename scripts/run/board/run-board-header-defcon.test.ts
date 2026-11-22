import { stripVTControlCharacters, styleText } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_header_defcon } from './run-board-header-defcon'
import type { BoardLayout, BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_theme_defs } from './run-board-theme-defs'

const { field_of, level_of } = run_board_header_defcon
const { EMPTY_LAYOUT, NOW, header } = run_board_render_fixture
const { THEME_DEFS } = run_board_theme_defs
const WARGAMES = { theme: 'wargames' } as const
const LANES = 3
const HALTED = 1
const ASKING = 2
const CRITICAL_IDLE = 3
const OVER_LIMIT = 4
const CALM = 5
const ESCAPE = '\u{1B}['
const QUOTA_HOLD = { reset_ms: NOW, parked: 0 }

type State = BoardRow['state']
type Priority = BoardRow['priority']

function row(number: number, state: State, priority?: Priority): BoardRow {
	return {
		number,
		title: undefined,
		kind: undefined,
		priority,
		state,
		status: undefined,
		waits: [],
	}
}

function running(count: number): Array<BoardRow> {
	return Array.from({ length: count }, (_, index) => row(index + 1, 'running'))
}

const P1_QUEUED: BoardLayout['queued'] = [{ kind: 'row', row: row(90, 'waiting', 'critical') }]
const FULL = running(LANES)
const OVER = running(LANES + 1)
const ONE = running(1)
const PERSON = [row(80, 'human')]

function board(layout: Partial<BoardLayout>, extra: Partial<BoardHeader> = {}): BoardHeader {
	return header({ layout: { ...EMPTY_LAYOUT, ...layout }, lane_limit: LANES, ...extra })
}

function level(layout: Partial<BoardLayout>, extra: Partial<BoardHeader> = {}): number {
	return level_of(board(layout, extra))
}

function header_line(index: number, extra: Partial<BoardHeader>): string {
	return stripVTControlCharacters(run_board_header.header_lines(board({}, extra))[index] ?? '')
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('run_board_header_defcon.level_of', () => {
	it('reads 5 where nothing is wrong', () => {
		expect(level({ active: FULL })).toBe(CALM)
	})

	it('reads 4 where more lanes run than the limit', () => {
		expect(level({ active: OVER })).toBe(OVER_LIMIT)
	})

	it('reads 3 where a P1 waits while a lane is free', () => {
		expect(level({ active: ONE, queued: P1_QUEUED })).toBe(CRITICAL_IDLE)
	})

	it('reads 2 where a person is asked to decide', () => {
		expect(level({ people: PERSON })).toBe(ASKING)
	})

	it.each([
		['stopped', { activity: { last_event_ms: NOW, is_stopped: true } }],
		['held by its usage', { quota_hold: QUOTA_HOLD }],
		['failing its reads', { read_failed_ms: NOW }],
	])('reads 1 where the run is %s', (_, held: Partial<BoardHeader>) => {
		expect(level({}, held)).toBe(HALTED)
	})

	it('takes the lowest level whose condition holds', () => {
		const layout = { active: ONE, queued: P1_QUEUED, people: PERSON }

		expect(level(layout)).toBe(ASKING)
		expect(level(layout, { read_failed_ms: NOW })).toBe(HALTED)
	})

	// The usual board: every lane running, one past its estimate — which no level reads — and a P1
	// queued behind them.
	it('stays above 3 on the usual board', () => {
		const late = { ...row(1, 'running'), waits: ['#2'] }

		expect(level({ active: [late, ...FULL.slice(1)], queued: P1_QUEUED })).toBe(CALM)
	})

	it('raises nothing on a P1 where no lane limit was read', () => {
		expect(level({ queued: P1_QUEUED }, { lane_limit: undefined })).toBe(CALM)
	})
})

describe('run_board_header_defcon.level_of on held seats and blocked P1s', () => {
	it('raises nothing when seats prevent a waiting P1 from launching', () => {
		const lane_capacity = { free: 0, bound: 'seats', seated: 9 } as const

		expect(level({ active: ONE, queued: P1_QUEUED }, { lane_capacity })).toBe(CALM)
	})

	it('counts an earlier run lane as a held seat', () => {
		expect(level({ active: ONE, queued: P1_QUEUED }, { occupied_count: LANES })).toBe(CALM)
		expect(level({ active: ONE }, { occupied_count: LANES + 1 })).toBe(OVER_LIMIT)
	})

	it('raises nothing on a P1 with standing blockers beside a free lane', () => {
		const blocked = { ...row(91, 'waiting', 'critical'), waits: ['#5'] }

		expect(level({ active: ONE, queued: [{ kind: 'row', row: blocked }] })).toBe(CALM)
	})

	it('raises nothing on a P1 held by a start time beside a free lane', () => {
		const reason = { icon: '⏳', not_before_ms: NOW + 1 }
		const later = { ...row(92, 'waiting', 'critical'), reason }

		expect(level({ active: ONE, queued: [{ kind: 'row', row: later }] })).toBe(CALM)
	})
})

describe('run_board_header_defcon.field_of', () => {
	it('brackets the current level alone, from 5 down', () => {
		expect(stripVTControlCharacters(field_of(CRITICAL_IDLE))).toBe('DEFCON 5 4 [3] 2 1')
	})

	it.each([
		[CALM, 'green'],
		[OVER_LIMIT, 'yellow'],
		[CRITICAL_IDLE, 'yellow'],
		[ASKING, 'red'],
		[HALTED, 'red'],
	] as const)('colors level %i %s', (step, color) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(field_of(step)).toContain(styleText(color, `[${String(step)}]`))
		expect(field_of(step)).toContain(ESCAPE)
	})

	it('draws no escape where stdout draws no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(field_of(HALTED)).not.toContain(ESCAPE)
	})
})

function alert_of(extra: Partial<BoardHeader>): string | undefined {
	const part = run_board_header.alert_part(board({}, extra))

	return part === undefined ? undefined : stripVTControlCharacters(part)
}

// joshuafolkken/kit#8513: the level rides the throughput rule's right end; the header draws it on no line.
describe('run_board_header.alert_part', () => {
	it('draws the level on a themed screen alone, and on no header line', () => {
		expect(alert_of(WARGAMES)).toBe('DEFCON [5] 4 3 2 1')
		expect(alert_of({})).toBeUndefined()
		expect(alert_of({ ...WARGAMES, form: 'chat' })).toBeUndefined()
		expect(header_line(0, WARGAMES)).not.toContain('DEFCON')
		expect(header_line(1, WARGAMES)).not.toContain('DEFCON')
	})

	// The theme's board name (joshuafolkken/kit#8604) is the one change.
	it('leaves the header of a themed screen as the plain one draws it but the board name', () => {
		expect(header_line(0, WARGAMES)).toBe(header_line(0, {}).replace('josh-board', 'josh-wopr'))
	})
})

// joshuafolkken/kit#8358: the theme's row picks how the level is drawn; the level stays shared.
describe('run_board_header.alert_part with the theme row alert', () => {
	it('draws the alert the theme row names, at the shared level', () => {
		const alert = vi.spyOn(THEME_DEFS.wargames, 'alert').mockReturnValue('ALERT')

		expect(alert_of(WARGAMES)).toBe('ALERT')
		expect(alert).toHaveBeenCalledWith(CALM)
	})

	it('draws no alert where no theme is drawn', () => {
		const alert = vi.spyOn(THEME_DEFS.wargames, 'alert')

		alert_of({})

		expect(alert).not.toHaveBeenCalled()
	})
})
