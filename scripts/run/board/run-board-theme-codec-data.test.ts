import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_data } from './run-board-theme-codec-data'

// joshuafolkken/kit#8917: the METAL GEAR theme's tables.

const { freq_at, life_color } = run_board_theme_codec_data

describe('run_board_theme_codec_data.freq_at', () => {
	it('dials round the stored channels', () => {
		expect(freq_at(0)).toBe('140.85')
		expect(freq_at(3)).toBe('141.80')
		expect(freq_at(4)).toBe('140.85')
	})
})

describe('run_board_theme_codec_data.life_color', () => {
	it('glints for three ticks every 90', () => {
		const glint = '180;235;255'

		expect(life_color(0)).toContain(glint)
		expect(life_color(3)).toContain('90;200;255')
		expect(life_color(90)).toContain(glint)
	})
})
