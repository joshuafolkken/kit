import { describe, expect, it } from 'vitest'
import { run_board_theme_ghost_data } from './run-board-theme-ghost-data'

// joshuafolkken/kit#9096: the ghost theme's tables — the invariants its parts rely on.

const { ASSEMBLE, CLOAK, DRIFT, GRAPH, HEX_DIGITS, INKS, INTRUSION, RGB, RING } =
	run_board_theme_ghost_data
const { theme_colors, theme_notes } = run_board_theme_ghost_data
const RGB_TRIPLE = /^(?:\d{1,3});(?:\d{1,3});(?:\d{1,3})$/u
const CHANNEL_MAX = 255
const HEX_LENGTH = 16
const NOTE_KEYS = ['a', 'i', 'n', 'p', 'r']
const PART_TICKS = 84

function by_name(first: string, second: string): number {
	return first.localeCompare(second)
}

function is_rgb(color: string): boolean {
	return RGB_TRIPLE.test(color) && color.split(';').every((part) => Number(part) <= CHANNEL_MAX)
}

describe('run_board_theme_ghost_data.RGB', () => {
	it('holds every color as an r;g;b triple', () => {
		expect(Object.values(RGB).filter((color) => !is_rgb(color))).toStrictEqual([])
	})
})

describe('run_board_theme_ghost_data.INKS', () => {
	it('styles every ink and keeps the bar and the flash apart', () => {
		expect(Object.values(INKS).filter((ink) => ink === '')).toStrictEqual([])
		expect(INKS.BAR).not.toBe(INKS.FLASH)
	})
})

describe('run_board_theme_ghost_data.theme_colors', () => {
	it('gives every role an r;g;b color, the notice role in orange', () => {
		expect(Object.values(theme_colors).filter((color) => !is_rgb(color))).toStrictEqual([])
		expect(theme_colors.notice).toBe(RGB.orange)
	})
})

describe('run_board_theme_ghost_data.theme_notes', () => {
	it('describes every demo event', () => {
		expect(Object.keys(theme_notes).toSorted(by_name)).toStrictEqual(NOTE_KEYS)
	})
})

describe('run_board_theme_ghost_data.HEX_DIGITS', () => {
	it('is the sixteen distinct hex digits', () => {
		expect(HEX_DIGITS).toHaveLength(HEX_LENGTH)
		expect(new Set(HEX_DIGITS).size).toBe(HEX_LENGTH)
	})
})

describe('run_board_theme_ghost_data tables', () => {
	it('keeps the graph’s nodes on its rows and the ring turning faster while busy', () => {
		expect(GRAPH.nodes.every((node) => node.y < GRAPH.rows.length)).toBe(true)
		expect(RING.text.length).toBeGreaterThan(0)
		expect(RING.busy_pace).toBeGreaterThan(RING.idle_pace)
	})

	it('runs the opening and the ending for the demo’s part ticks', () => {
		expect([ASSEMBLE.ticks, DRIFT.ticks]).toStrictEqual([PART_TICKS, PART_TICKS])
		expect(ASSEMBLE.wave_ticks).toBe(ASSEMBLE.line.length)
		expect(ASSEMBLE.wave_ticks).toBeLessThan(ASSEMBLE.ticks)
		expect(DRIFT.gone).toBeLessThan(DRIFT.ticks)
	})

	it('links only nodes the cloak’s graph has', () => {
		const nodes = Object.values(CLOAK.nodes)

		expect(CLOAK.links.every((ends) => nodes.includes(ends.from) && nodes.includes(ends.to))).toBe(
			true,
		)
		expect(CLOAK.blink_lit).toBeLessThan(CLOAK.blink)
	})

	it('restores and shrinks the intrusion within its play', () => {
		expect(INTRUSION.restore_from + INTRUSION.restore_ticks).toBeLessThanOrEqual(INTRUSION.play)
		expect(INTRUSION.shrink_from + INTRUSION.shrink_ticks).toBeLessThanOrEqual(INTRUSION.play)
		expect(INTRUSION.blink_lit).toBeLessThan(INTRUSION.blink)
	})
})
