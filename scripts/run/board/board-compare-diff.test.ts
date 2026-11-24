import { describe, expect, it } from 'vitest'
import { board_compare_diff, type Mode } from './board-compare-diff'
import { board_compare_screen } from './board-compare-screen'
import type { Beat } from './run-board-reveal-blocks'

const SIZE = { columns: 12, rows: 4 }
const TICK_MS = 50
const ESC = '\u{1B}['
// Three frames a 12×4 board draws: the top row's text changes each beat, the second row stays.
const FRAMES = [
	['ab', 'status'],
	['ac', 'status'],
	['ad', 'status'],
]

function red(row: string): string {
	return `${ESC}31m${row}${ESC}0m${ESC}K`
}

function full(rows: ReadonlyArray<string>): string {
	return `${ESC}H${rows.map((row) => red(row)).join('\r\n')}`
}

async function first(
	expected: Array<Beat>,
	actual: Array<Beat>,
	mode: Mode = 'strict',
): Promise<ReturnType<typeof board_compare_diff.first_divergence>> {
	const [left, right] = await Promise.all([
		board_compare_screen.shots_of(expected, SIZE),
		board_compare_screen.shots_of(actual, SIZE),
	])

	return board_compare_diff.first_divergence(left, right, mode)
}

function beats(texts: ReadonlyArray<string>): Array<Beat> {
	return texts.map((text) => ({ text, ms: TICK_MS }))
}

describe('board_compare_diff.first_divergence', () => {
	it('reports the beat after a mid-frame clear in a changed-cells-only drawing (#8732 before its fix)', async () => {
		const expected = beats(FRAMES.map((rows) => full(rows)))
		// The first beat draws everything; later beats write the changed cell only, the top row's write
		// carrying a home and clear-to-end, which wipes the unchanged second row.
		const actual = beats([
			full(FRAMES[0] ?? []),
			`${ESC}H${ESC}J${ESC}31mac${ESC}0m`,
			`${ESC}1;2H${ESC}31md${ESC}0m`,
		])

		expect(await first(expected, actual)).toMatchObject({
			at_ms: TICK_MS,
			count: 'status'.length,
			samples: [{ where: 'row 1 col 0' }, {}, {}, {}, {}],
		})
	})

	it('reports 0 differences for other bytes that draw the same screen', async () => {
		const expected = beats([`${ESC}31mab${ESC}0m\r\n${ESC}32mcd${ESC}0m`])
		// The rows written bottom first, the reset left out and the color written once per run.
		const actual = beats([`${ESC}2;1H${ESC}32mcd${ESC}1;1H${ESC}31mab${ESC}0m`])

		expect(await first(expected, actual)).toBeUndefined()
	})

	it.each([
		['foreground', `${ESC}32mab`],
		['background', `${ESC}31;44mab`],
		['bold', `${ESC}1;31mab`],
	])('reports a %s-only difference', async (_, text) => {
		const divergence = await first(beats([`${ESC}31mab`]), beats([text]))

		expect(divergence?.count).toBe('ab'.length)
	})
})

describe('board_compare_diff.first_divergence moments', () => {
	it('compares the screens shown at the same moment though the beats are cut differently', async () => {
		const expected = [
			{ text: 'a', ms: TICK_MS * 2 },
			{ text: 'b', ms: 0 },
		]
		const actual = [
			{ text: 'a', ms: TICK_MS },
			{ text: '', ms: TICK_MS },
			{ text: 'b', ms: 0 },
		]

		expect(await first(expected, actual)).toBeUndefined()
	})
})

describe('board_compare_diff.first_divergence loose', () => {
	it('reports 0 differences for the same glyphs and colors drawn in another random order', async () => {
		const expected = beats([`${ESC}32mx  y${ESC}2;3Hz`])
		const actual = beats([`${ESC}32m y x${ESC}2;5Hz`])

		expect(await first(expected, actual, 'loose')).toBeUndefined()
	})

	it('reports a different glyph set', async () => {
		const divergence = await first(beats([`${ESC}32mxy`]), beats([`${ESC}32mxq`]), 'loose')

		expect(divergence?.samples[0]?.where).toBe('chars')
	})

	it('reports a different color set', async () => {
		const divergence = await first(beats([`${ESC}32mxy`]), beats([`${ESC}33mxy`]), 'loose')

		expect(divergence?.samples[0]?.where).toBe('colors')
	})

	it('reports a different density', async () => {
		const divergence = await first(
			beats([`${ESC}32m${'x'.repeat(SIZE.columns)}`]),
			beats([`${ESC}32mx`]),
			'loose',
		)

		expect(divergence?.samples[0]?.where).toBe('density')
	})
})
