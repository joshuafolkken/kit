import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_call } from './run-board-theme-codec-call'
import { run_board_theme_codec_data } from './run-board-theme-codec-data'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the METAL GEAR theme's codec call.

const { blip_level, codec_freq, dialing, level_bars, talking_level, voice_level } =
	run_board_theme_codec_call
const { STYLE } = run_board_theme_codec_data
const { row_of } = run_board_theme_host_grid

function blank(rows: number, width: number): Grid {
	return Array.from({ length: rows }, () => row_of('', 'body', width))
}

describe('run_board_theme_codec_call.dialing', () => {
	it('locks a digit every two ticks from the left, the point always shown', () => {
		const half = dialing('140.85', 6, 3, 7)

		expect(half.slice(0, 3)).toBe('140')
		expect(half.charAt(3)).toBe('.')
		expect(half).toMatch(/^\d{3}\.\d{2}$/u)
		expect(dialing('140.85', 14, 3, 7)).toBe('140.85')
	})

	it('dials the channel of the progress line from its start', () => {
		expect(codec_freq({ index: 1, start: 0 }, 20)).toBe('141.12')
		expect(codec_freq({ index: -1, start: 0 }, 20)).toBe('140.85')
	})
})

describe('run_board_theme_codec_call.voice_level', () => {
	const idle = { is_typing: false, index: -1, cooled: 0 }

	it('jumps between 3 and 10 while the line types', () => {
		const level = voice_level({ ...idle, is_typing: true, index: 0 }, 9)

		expect(level).toBe(talking_level(9))
		expect(level).toBeGreaterThanOrEqual(3)
		expect(level).toBeLessThanOrEqual(10)
	})

	it('falls away from 4 after the line, then blips while idle', () => {
		expect(voice_level({ ...idle, index: 0, cooled: 0 }, 0)).toBe(4)
		expect(voice_level({ ...idle, index: 0, cooled: 7 }, 0)).toBe(1)
		expect(voice_level({ ...idle, index: 0, cooled: 8 }, 2)).toBe(3)
		expect([0, 1, 2, 3, 4, 5, 50].map((tick) => blip_level(tick))).toStrictEqual([
			1, 2, 3, 2, 1, 0, 1,
		])
	})
})

describe('run_board_theme_codec_call.level_bars', () => {
	it('lights the bars from the bottom as far as the voice carries', () => {
		const grid = blank(3, 4)

		level_bars(grid, { y: 0, x: 0 }, [4, 3, 2], 7)

		expect(grid.map((row) => row.map(([ch]) => ch).join(''))).toStrictEqual([
			'▀▀▀▀',
			'▀▀▀ ',
			'▀▀  ',
		])
		expect(grid.map((row) => row[0]?.[1])).toStrictEqual([
			STYLE.bar_off,
			STYLE.bar_on,
			STYLE.bar_on,
		])
	})
})
