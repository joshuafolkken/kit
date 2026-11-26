import { describe, expect, it } from 'vitest'
import type { Cell } from './run-board-theme-host-types'
import { run_board_theme_trace_fixture } from './run-board-theme-trace-fixture'
import { run_board_theme_trace_pass } from './run-board-theme-trace-pass'

// joshuafolkken/kit#8917: MATRIX's code rain's one pass over the board.

const { HOST, board_copy } = run_board_theme_trace_fixture
const { fallen_of, heads_of, pass, pass_cell, pass_ticks } = run_board_theme_trace_pass
const SCENE = { tail: { least: 1, spread: 1 }, speed: { least: 0.55, spread: 0.75 }, salt: 201 }
const HEAD = { at: 0, speed: 1, length: 5 }
const OWN: Cell = ['A', 'hi']

describe('run_board_theme_trace_pass', () => {
	it('falls a row a frame, then gains after a while', () => {
		const fallen = fallen_of()

		expect(fallen.slice(0, 3)).toStrictEqual([0, 1, 2])
		expect(fallen).toHaveLength(2000)
		expect((fallen[1999] ?? 0) - (fallen[1998] ?? 0)).toBeGreaterThan(1)
	})

	it('shows the board ahead of the rain, rain in it, and a blank behind it', () => {
		const moment = { frame: 0, rows_fallen: 2, shows: { ahead: true, behind: false } }
		const passed = { ...moment, rows_fallen: 9 }

		expect(pass_cell(moment, HEAD, { x: 0, y: 4 }, OWN)).toBe(OWN)
		expect(pass_cell(passed, HEAD, { x: 0, y: 0 }, OWN)).toStrictEqual([' ', 'body'])
		expect(pass_cell(moment, HEAD, { x: 0, y: 0 }, OWN)).not.toBe(OWN)
	})

	it('reveals the board behind the tails, blank ahead of them', () => {
		const fallen = fallen_of()
		const heads = heads_of(HOST.layout, SCENE)
		const sweep = { heads, fallen, shows: { ahead: false, behind: true } }
		const ticks = pass_ticks(sweep, HOST.layout.h)
		const first = board_copy()
		const last = board_copy()

		pass(first, sweep, 0, HOST.layout.h)
		pass(last, sweep, ticks, HOST.layout.h)

		expect(first.at(-1)?.every(([ch]) => ch === ' ')).toBe(true)
		expect(last).toStrictEqual(HOST.api.board)
	})
})
