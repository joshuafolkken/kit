import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_nixie_mail } from './run-board-theme-nixie-mail'

// joshuafolkken/kit#8917: STEINS;GATE's D-mail window — its bytes arrive with the notice, those not
// yet in shown as dots, and the window shows only while the mail comes in.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { bytes_of, mail, mail_line } = run_board_theme_nixie_mail

function board_copy(): Grid {
	return HOST.board.map((row) => [...row])
}

function row_text(grid: Grid, y: number): string {
	return (grid[y] ?? []).map(([ch]) => ch).join('')
}

describe('run_board_theme_nixie_mail.mail_line', () => {
	it('spaces a row of twelve bytes, dots for those not yet in', () => {
		expect(mail_line(0, 3)).toBe('# 8 8 · · · · · · · · ·')
	})
})

describe('run_board_theme_nixie_mail.bytes_of', () => {
	it('fills all 36 bytes by the time the giant meter takes over', () => {
		const { notice } = state_of(HOST.layout, HOST.events.n, 50)

		expect(bytes_of({ ...notice, length: notice.total })).toBe(36)
		expect(bytes_of({ ...notice, length: 0 })).toBe(0)
	})
})

describe('run_board_theme_nixie_mail.mail', () => {
	it('opens the window early in the notice and not afterward', () => {
		const early = board_copy()
		const late = board_copy()

		mail({ api: HOST.api, grid: early, state: state_of(HOST.layout, HOST.events.n, 20), tick: 20 })
		mail({ api: HOST.api, grid: late, state: state_of(HOST.layout, HOST.events.n, 80), tick: 80 })
		expect(row_text(early, HOST.layout.area_top)).toContain('┌─ D-MAIL ')
		expect(late).toStrictEqual(HOST.board)
	})
})
