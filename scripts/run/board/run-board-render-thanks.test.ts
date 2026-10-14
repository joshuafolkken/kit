import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_render_thanks } from './run-board-render-thanks'
import type { Thanks } from './run-board-thanks-csv'

// joshuafolkken/kit#3809: the reviewers are drawn as names alone on one line, a name with a page
// wrapped in an OSC 8 link, and wrapped between names where the pane is too narrow.

const { thanks_lines } = run_board_render_thanks
const KITTEN_URL = 'https://x.com/KittenLab'
const THANKS: Thanks = [
	{ name: 'fish', url: undefined },
	{ name: 'KittenLab', url: KITTEN_URL },
]

function osc8(text: string, url: string): string {
	return `\u{1B}]8;;${url}\u{7}${text}\u{1B}]8;;\u{7}`
}

describe('run_board_render_thanks.thanks_lines', () => {
	it('draws every name on one line under a blank, linking only a name with a page', () => {
		expect(thanks_lines(THANKS, osc8, undefined)).toStrictEqual([
			'',
			`  fish  ${osc8('KittenLab', KITTEN_URL)}`,
		])
	})

	it('draws nothing with no one to thank', () => {
		expect(thanks_lines([], osc8, undefined)).toStrictEqual([])
	})

	it('wraps between names, counting a linked name by the columns it shows', () => {
		const names: Thanks = ['aaaa', 'bbbb', 'cccc'].map((name) => ({
			name,
			url: `https://example.com/${name}`,
		}))
		const lines = thanks_lines(names, osc8, 12).map((line) => stripVTControlCharacters(line))

		expect(lines).toStrictEqual(['', '  aaaa  bbbb', '  cccc'])
	})

	it('gives a name wider than the pane a line of its own', () => {
		const names: Thanks = [
			{ name: 'a', url: undefined },
			{ name: 'x'.repeat(20), url: undefined },
		]

		expect(thanks_lines(names, osc8, 10)).toStrictEqual(['', '  a', `  ${'x'.repeat(20)}`])
	})
})
