import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_jump } from './run-board-jump'
import { run_board_jump_screen, type JumpDraw } from './run-board-jump-screen'
import { run_board_jump_start, type JumpFrame } from './run-board-jump-start'
import { run_board_row_key } from './run-board-row-key'
import type { Typing, TypingLine } from './run-board-type-rows'

const { arrive_of, jump_of, jump_state } = run_board_jump_start
const { END_TICKS, THAW_AT, THAW_TICKS, TICK_MS, WASH_TICKS, tick_of } = run_board_jump

const NOW = 1000
const ROW_TEXT = 'lane 8731 implementing'
const LINES = ['header', 'one', 'two', 'three', ROW_TEXT]

function line_of(text: string, start_ms = NOW, key = 'lanes:8731'): TypingLine {
	return { key, index: 4, row: 5, text, prefix_columns: 0, start_ms }
}

function typing_of(...lines: Array<TypingLine>): Typing {
	return { seen: new Set(), lines }
}

function frame_of(overrides: Partial<JumpFrame> = {}): JumpFrame {
	return {
		ports: { theme: 'bttf', is_tty: true },
		drawn: { lines: LINES, spots: [], size: undefined },
		typing: typing_of(line_of(ROW_TEXT)),
		area: undefined,
		now_ms: NOW,
		...overrides,
	}
}

function must(draw: JumpDraw | undefined): JumpDraw {
	if (draw === undefined) throw new Error('no jump started')

	return draw
}

function started(frame: JumpFrame = frame_of()): JumpDraw {
	return must(jump_of(undefined, frame))
}

function trail_draw(lines: ReadonlyArray<string>): JumpDraw {
	return started(frame_of({ drawn: { lines, spots: [], size: undefined } }))
}

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_jump_start.jump_state — the typing cue', () => {
	it('ac-075efb73 starts a jump on a bttf frame whose row starts typing, with no notice trace', () => {
		const jump = must(jump_state({}, frame_of()).jump)
		const jumped_ms = NOW + jump.run.letters * TICK_MS

		expect(run_board_jump_screen.jump_bytes(jump, jumped_ms, undefined)).not.toBe('')
	})

	it('ac-075efb73 starts the same jump whatever row types, a notice row or a body row', () => {
		const notice_key = run_board_row_key.key_of('notice', 'merged')
		const typing = typing_of(line_of(ROW_TEXT, NOW, notice_key))

		expect(started(frame_of({ typing })).run).toStrictEqual(started().run)
	})

	it('starts on no typing, in no other theme, nor off a color terminal', () => {
		const typing = typing_of()

		expect(jump_of(undefined, frame_of({ typing }))).toBeUndefined()
		expect(
			jump_of(undefined, frame_of({ ports: { theme: 'matrix', is_tty: true } })),
		).toBeUndefined()
		expect(
			jump_of(undefined, frame_of({ ports: { theme: 'bttf', is_tty: false } })),
		).toBeUndefined()
		vi.stubEnv('FORCE_COLOR', '0')
		expect(jump_of(undefined, frame_of())).toBeUndefined()
	})
})

describe('run_board_jump_start.jump_state — the typing run', () => {
	it('ac-61ea24a8 jumps on the tick after the last letter, the row letters × 50 ms in', () => {
		const { run } = started()

		expect(run).toStrictEqual({ start_ms: NOW, letters: ROW_TEXT.length })
		expect(tick_of(run, NOW + ROW_TEXT.length * TICK_MS - 1)).toBe(-1)
		expect(tick_of(run, NOW + ROW_TEXT.length * TICK_MS)).toBe(0)
	})

	it('counts the longest of the rows starting together', () => {
		const typing = typing_of(line_of('short'), line_of(ROW_TEXT), line_of('mid row'))

		expect(started(frame_of({ typing })).run.letters).toBe(ROW_TEXT.length)
	})

	it('ac-a748b0ea starts on a frame drawn late, from the typing first letter', () => {
		const late = frame_of({ now_ms: NOW + TICK_MS * 3 })

		expect(started(late).run.start_ms).toBe(NOW)
	})

	it('starts on no row with no letters to type past its prefix', () => {
		const typing = typing_of({ ...line_of(ROW_TEXT), prefix_columns: ROW_TEXT.length })

		expect(jump_of(undefined, frame_of({ typing }))).toBeUndefined()
	})

	it('cues each typing once, so a typing already cued starts none', () => {
		const state = jump_state({}, frame_of())

		expect(state.cued_ms).toBe(NOW)
		expect(jump_of(undefined, frame_of({ now_ms: NOW + TICK_MS }), state.cued_ms)).toBeUndefined()
	})
})

describe('run_board_jump_start.jump_of — the fire trails', () => {
	const THROUGHPUT_RULE = '── 📈 throughput ──'

	it('burns the fire trails on the blank rows above the throughput rule and the lanes rule', () => {
		const lines = ['header', '', THROUGHPUT_RULE, 'x', '', '── 🧵 lanes ──', ROW_TEXT]

		expect(trail_draw(lines).scene.trails).toStrictEqual([1, 4])
	})

	it('fills the blank trail rows out with cells, so the head burns on a real board', () => {
		const draw = trail_draw(['header', '', THROUGHPUT_RULE, ROW_TEXT])
		const jumped_ms = NOW + draw.run.letters * TICK_MS
		const written = run_board_jump_screen.jump_bytes(draw, jumped_ms, undefined)

		expect(draw.screen.rows[1]).toHaveLength(draw.screen.columns)
		expect(written).toMatch(/\[2;1H.*█/u)
	})
})

// joshuafolkken/kit#8739: the bttf board as it draws today, with its shape icons, its two rules given.
function bttf_draw(throughput_rule: string, lanes_rule: string): JumpDraw {
	const lines = [
		'> josh-flux      -> 11-23 10:53',
		'',
		`${throughput_rule} ──────── /h ACTIVE ─ DONE ─ PEAK ─ NOW ──`,
		'     24h  ▄█▆▇▇▄▃▅▄▂▁▃▁█▂▃█▆▂   3.4    20h     71    7.0     2',
		'',
		`${lanes_rule} 1/6 ─ T+ ─────── CPU ────── MEM ──────`,
		ROW_TEXT,
	]
	const ports = { theme: 'bttf' as const, is_tty: true, icons: 'shapes' as const }

	return started(frame_of({ ports, drawn: { lines, spots: [], size: undefined } }))
}

describe('run_board_jump_start.jump_of — the fire trails on the bttf board', () => {
	it('ac-876edb02 burns the trails on the bttf board as drawn today, its shape icons on', () => {
		expect(bttf_draw('── -- throughput', '── ── lanes').scene.trails).toStrictEqual([1, 4])
	})

	// Live, an open section's rule leads with `▾`, which the bttf restyle turns into `V` with shape
	// icons — the trails were looked for in that text and never found.
	it('ac-876edb02 burns the trails under rules led by the fold mark the theme restyles', () => {
		const draw = bttf_draw('\u{1B}[1m▾ -- throughput\u{1B}[0m', '▾ ── lanes')
		const rule = draw.screen.rows[5]?.map((cell) => cell.text).join('') ?? ''

		expect(rule.startsWith('▾')).toBe(false)
		expect(draw.scene.trails).toStrictEqual([1, 4])
	})

	it('burns a trail on the screen row its blank line lands on, past a line above it that wraps', () => {
		const size = { columns: 10, rows: 9 }
		const lines = ['a header wider than ten', '', '── lanes ──', ROW_TEXT]
		const draw = started(frame_of({ drawn: { lines, spots: [], size } }))
		const above = draw.screen.rows[3]?.map((cell) => cell.text).join('')

		expect(draw.scene.trails).toStrictEqual([3])
		expect(above?.trim()).toBe('')
	})
})

describe('run_board_jump_start.jump_of — the whole terminal', () => {
	it('ac-a79a8a81 fills every row out to the terminal width and adds blank rows to its height', () => {
		const size = { columns: 40, rows: 9 }
		const draw = started(frame_of({ drawn: { lines: LINES, spots: [], size } }))

		expect(draw.screen.rows).toHaveLength(size.rows)
		expect(draw.screen.rows.every((row) => row.length === size.columns)).toBe(true)
	})

	it('ac-a79a8a81 washes the blank rows, the line ends and the rows past the board', () => {
		const size = { columns: 40, rows: 9 }
		const draw = started(frame_of({ drawn: { lines: LINES, spots: [], size } }))
		const jumped_ms = NOW + draw.run.letters * TICK_MS
		const written = run_board_jump_screen.jump_bytes(draw, jumped_ms, undefined)

		// The header's line end, and the last cell of the terminal's last row, past the board.
		expect(written).toContain('\u{1B}[1;40H')
		expect(written).toContain('\u{1B}[9;40H')
	})
})

describe('run_board_jump_start.jump_state once running', () => {
	const later = NOW + TICK_MS * 2
	const next_typing = typing_of(line_of('next row', later))

	it('carries the running jump and cues the typing that starts meanwhile', () => {
		const first = jump_state({}, frame_of())
		const next = jump_state(first, frame_of({ now_ms: later, typing: next_typing }))

		expect(next.jump?.run.start_ms).toBe(NOW)
		expect(next.cued_ms).toBe(later)
	})

	it('never starts from a typing cued while the last jump ran', () => {
		const over = NOW + (ROW_TEXT.length + END_TICKS) * TICK_MS
		const frame = frame_of({ now_ms: over, typing: next_typing })

		expect(jump_state({ cued_ms: later }, frame).jump).toBeUndefined()
	})

	it('yields to a typing not yet cued once thawed, with only its fire trails burning', () => {
		const first = jump_state({}, frame_of())
		const thawed = NOW + (ROW_TEXT.length + WASH_TICKS + THAW_TICKS) * TICK_MS
		const fresh = frame_of({ now_ms: thawed, typing: typing_of(line_of('next row', thawed)) })

		expect(jump_state(first, fresh).jump?.run.start_ms).toBe(thawed)
		expect(jump_state(first, frame_of({ now_ms: thawed })).jump?.run.start_ms).toBe(NOW)
	})

	it('draws nothing once the jump is over', () => {
		const first = jump_state({}, frame_of())
		const over = NOW + (ROW_TEXT.length + END_TICKS) * TICK_MS

		expect(jump_state(first, frame_of({ now_ms: over })).jump).toBeUndefined()
	})
})

describe('run_board_jump_start.arrive_of', () => {
	const area = { top: 1, end: 2, rows: 2, lamps: [] }
	const live = { theme: 'bttf' as const, is_tty: true, opened_ms: 0 }

	it('starts the arrival at its thaw on a live bttf board first drawing its area', () => {
		const arrived = arrive_of(undefined, frame_of({ ports: live, area }))

		expect(arrived).toBe(NOW - THAW_AT * TICK_MS)
	})

	it('keeps the arrival once it is set', () => {
		const later = frame_of({ ports: live, area, now_ms: NOW + TICK_MS })

		expect(arrive_of(NOW, later)).toBe(NOW)
		expect(arrive_of(NOW, frame_of())).toBe(NOW)
	})

	it('starts no arrival without the area, off a live board, or in another theme', () => {
		expect(arrive_of(undefined, frame_of({ ports: live }))).toBeUndefined()
		expect(arrive_of(undefined, frame_of({ area }))).toBeUndefined()
		const matrix = { ...live, theme: 'matrix' as const }

		expect(arrive_of(undefined, frame_of({ ports: matrix, area }))).toBeUndefined()
	})
})
