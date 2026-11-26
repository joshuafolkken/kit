import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_heading_icons } from './run-board-heading-icons'
import { run_board_labels } from './run-board-labels'
import { run_board_theme_glyphs } from './run-board-theme-glyphs'

const { QUEUED_HEADING_ICON, WAITING_HEADING_ICON } = run_board_heading_icons
const { STATE_ICONS, WAITS_ICON } = run_board_labels
const LETTERS = { theme: undefined, icons: 'letters' } as const

function letters_of(icon: string): string {
	return stripVTControlCharacters(run_board_theme_glyphs.textual(icon, LETTERS))
}

describe('run_board_heading_icons — the queued and waiting headings', () => {
	it.each([QUEUED_HEADING_ICON, WAITING_HEADING_ICON])('draws %s as the rule `--`', (icon) => {
		expect(letters_of(icon)).toBe('--')
	})

	it('keeps the row icons apart from the heading icons', () => {
		expect(QUEUED_HEADING_ICON).not.toBe(STATE_ICONS.waiting)
		expect(WAITING_HEADING_ICON).not.toBe(WAITS_ICON)
		expect(
			stripVTControlCharacters(run_board_theme_glyphs.textual(STATE_ICONS.waiting, LETTERS)),
		).toBe('HD')
	})
})
