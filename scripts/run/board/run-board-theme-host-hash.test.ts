import { describe, expect, it } from 'vitest'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'

// joshuafolkken/kit#8917: the theme host's noise is the confirmed theme demo's, value for value.

const { hash } = run_board_theme_host_hash

function values_of(): Array<number> {
	return Array.from({ length: 200 }, (_, tick) => hash(tick, tick % 7, 300))
}

describe('run_board_theme_host_hash.hash', () => {
	it('gives the demo host’s values', () => {
		expect(hash(0)).toBe(0)
		expect(hash(1, 2, 3)).toBe(0.5008470041211694)
		expect(hash(-5, 7, 900)).toBe(0.22021827124990523)
		expect(hash(123_456, 5, 3)).toBe(0.12279060995206237)
		expect(hash(2.7, 1.2, 0)).toBe(0.9787220696453005)
	})

	it('gives the same value for the same arguments, in [0, 1)', () => {
		const values = values_of()

		expect(values).toStrictEqual(values_of())
		expect(values.every((value) => value >= 0 && value < 1)).toBe(true)
		expect(new Set(values).size).toBeGreaterThan(190)
	})
})
