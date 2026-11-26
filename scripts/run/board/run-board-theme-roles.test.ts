import { describe, expect, it } from 'vitest'
import { run_board_cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import { run_board_theme_roles } from './run-board-theme-roles'

const { grid_of, key_of, role_of } = run_board_theme_roles
const ESC = '\u{1B}['

describe('run_board_theme_roles.role_of', () => {
	it('reads each matrix color as its role', () => {
		expect(role_of(`${ESC}38;2;0;100;22m`)).toBe('rule')
		expect(role_of(`${ESC}38;2;255;69;58m`)).toBe('red')
		expect(role_of(`${ESC}32m`)).toBe('ok')
	})

	it('reads an unknown color, or none, as the body', () => {
		expect(role_of(`${ESC}38;2;1;2;3m`)).toBe('body')
		expect(role_of('')).toBe('body')
	})
})

describe('run_board_theme_roles.key_of', () => {
	it('adds the dim or bold attribute the style leaves set', () => {
		expect(key_of(`${ESC}38;2;0;215;60m${ESC}2m`)).toBe('body:dim')
		expect(key_of(`${ESC}1m${ESC}38;2;255;255;255m`)).toBe('hi:bold')
		expect(key_of(`${ESC}2m${ESC}22m`)).toBe('body')
	})
})

describe('run_board_theme_roles.grid_of', () => {
	it('reads every cell as its character and role, a wide second half as empty', () => {
		const cells = run_board_cells.cells_of({ rows: 1, columns: 4 })

		run_board_cells_ansi.paint(cells, `${ESC}38;2;0;100;22m-🔊x`)

		expect(grid_of(cells)).toEqual([
			[
				['-', 'rule'],
				['🔊', 'rule'],
				['', 'rule'],
				['x', 'rule'],
			],
		])
	})
})
