import { describe, expect, it } from 'vitest'
import { run_board_theme_case } from './run-board-theme-case'

// joshuafolkken/kit#7988: the WarGames theme's text in capitals, its escapes as written.

const ESCAPE = '\u{1B}'
// Letters outside ASCII keep their case, so none changes its width (`ß` would become `SS`).
const NON_ASCII = 'ß é — 人の判断'

describe('run_board_theme_case.capitals', () => {
	it.each([
		{ text: 'a Title 7', drawn: 'A TITLE 7' },
		{ text: `${ESCAPE}[31m red${ESCAPE}[39m`, drawn: `${ESCAPE}[31m RED${ESCAPE}[39m` },
		{ text: `${ESCAPE}[2;5Hx${ESCAPE}[K`, drawn: `${ESCAPE}[2;5HX${ESCAPE}[K` },
		{
			text: `${ESCAPE}]8;;https://a.b/c/d\u{7}link${ESCAPE}]8;;\u{7}`,
			drawn: `${ESCAPE}]8;;https://a.b/c/d\u{7}LINK${ESCAPE}]8;;\u{7}`,
		},
		{
			text: `${ESCAPE}]8;;https://a.b/c${ESCAPE}\\link${ESCAPE}]8;;${ESCAPE}\\`,
			drawn: `${ESCAPE}]8;;https://a.b/c${ESCAPE}\\LINK${ESCAPE}]8;;${ESCAPE}\\`,
		},
		{ text: NON_ASCII, drawn: NON_ASCII },
	])('draws $text as $drawn', ({ text, drawn }) => {
		expect(run_board_theme_case.capitals(text)).toBe(drawn)
	})
})
