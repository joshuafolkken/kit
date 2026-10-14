import { stripVTControlCharacters, styleText } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_fresh, type FreshFrame } from './run-board-fresh'

// joshuafolkken/kit#3784: a part of the board is emphasized for about three seconds after it updates,
// fading inverse → bold and color → bold → plain, decided by its age alone.

const { aged, padded, paint, since, stage_of } = run_board_fresh
const SECOND = 1000
const INVERSE = 'inverse'
const BOLD_COLOR = 'bold-color'
const NOW = Date.parse('2026-10-14T09:00:00.000Z')
const LIVE: FreshFrame = { now_ms: NOW, form: 'screen', spinner: '⠙' }

describe('run_board_fresh.stage_of', () => {
	it.each([
		[0, INVERSE],
		[SECOND - 1, INVERSE],
		[SECOND, BOLD_COLOR],
		[2 * SECOND - 1, BOLD_COLOR],
		[2 * SECOND, 'bold'],
		[3 * SECOND - 1, 'bold'],
		[3 * SECOND, 'none'],
		[-1, 'none'],
		[undefined, 'none'],
	])('draws a part %s ms old in the %s stage', (age_ms, stage) => {
		expect(stage_of(age_ms)).toBe(stage)
	})
})

describe('run_board_fresh.aged', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('paints each stage on a live screen and leaves a settled part plain', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(aged('0:00', 0, LIVE)).toBe(styleText(INVERSE, '0:00'))
		expect(aged('0:01', SECOND, LIVE)).toBe(styleText(['bold', 'cyan'], '0:01'))
		expect(aged('0:02', 2 * SECOND, LIVE)).toBe(styleText('bold', '0:02'))
		expect(aged('0:03', 3 * SECOND, LIVE)).toBe('0:03')
	})

	it('never paints a chat frame or a frame with no spinner — `--once`, a pipe', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(aged('0:00', 0, { ...LIVE, form: 'chat' })).toBe('0:00')
		expect(aged('0:00', 0, { ...LIVE, spinner: undefined })).toBe('0:00')
	})

	it('ages a part from the moment it changed, and leaves one with no moment plain', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(since('🔚 09:00', NOW - SECOND, LIVE)).toBe(paint('🔚 09:00', BOLD_COLOR))
		expect(since('🔚 09:00', undefined, LIVE)).toBe('🔚 09:00')
		expect(paint('', INVERSE)).toBe('')
	})
})

describe('run_board_fresh.padded', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('keeps the padding outside the emphasis, so the column keeps its width', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const drawn = padded('0:00', 7, aged('0:00', 0, LIVE))

		expect(drawn).toBe(`   ${styleText(INVERSE, '0:00')}`)
		expect(run_board_fit.width_of(drawn)).toBe(7)
		expect(stripVTControlCharacters(drawn)).toBe('0:00'.padStart(7))
	})
})
