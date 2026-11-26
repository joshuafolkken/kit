import { describe, expect, it } from 'vitest'
import { run_board_theme_magi_data } from './run-board-theme-magi-data'

// joshuafolkken/kit#8917: the MAGI theme's tables are the confirmed theme demo's.

const { BAND, MAGI_END, MAGI_OPEN, PACES, VERDICTS } = run_board_theme_magi_data

describe('run_board_theme_magi_data', () => {
	it('builds the WARNING band from stripes, WARNING, stripes and EMERGENCY', () => {
		expect(BAND.map(([ch]) => ch).join('')).toBe('◢◤◢◤◢◤◢◤ WARNING ◢◤◢◤ EMERGENCY ')
	})

	it('gives each progress line a verdict for each of the three panels', () => {
		expect(VERDICTS.every((row) => row.length === 3)).toBe(true)
		expect(VERDICTS[0]).toStrictEqual([1, 1, 0])
	})

	it('orders the opening and ending beats', () => {
		expect(MAGI_OPEN.green).toBeLessThan(MAGI_OPEN.unfold)
		expect(MAGI_OPEN.bloom).toBeLessThan(MAGI_OPEN.done)
		expect(MAGI_END.collapse).toBeLessThan(MAGI_END.line)
		expect(MAGI_END.gone).toBeLessThan(MAGI_END.ticks)
	})

	it('quickens the pace from idle to progress to row', () => {
		expect(PACES.idle.speed).toBeLessThan(PACES.progress.speed)
		expect(PACES.progress.beat).toBeGreaterThan(PACES.row.beat)
	})
})
