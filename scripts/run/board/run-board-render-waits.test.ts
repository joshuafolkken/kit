import type { BudgetWait } from '#scripts/gate/core-wait'
import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_waits } from './run-board-render-waits'

// joshuafolkken/kit#3943: a claim waiting in the core budget was on no board, so a lane held back by
// memory pressure read the same as a stuck one. The board draws each waiting claim under its header.

const { header, lines_of } = run_board_render_fixture
const WAITS: ReadonlyArray<BudgetWait> = [
	{
		command: 'gate lint',
		lane: '3943',
		elsewhere: undefined,
		waited_ms: 12_400,
		reason: 'pressure',
	},
	{ command: 'check', lane: undefined, elsewhere: undefined, waited_ms: 3000, reason: 'cores' },
	{
		command: 'audit',
		lane: undefined,
		elsewhere: '.app-kit-lanes/12',
		waited_ms: 0,
		reason: 'memory',
	},
]

function linked(reference: string): string {
	return `#${reference}`
}

describe('run_board_render_waits.wait_lines', () => {
	it('names the command, lane, seconds waited and reason of each waiting claim', () => {
		expect(run_board_render_waits.wait_lines(WAITS, linked)).toStrictEqual([
			'',
			'🚧 gate lint  #3943  12s  memory under pressure',
			'🚧 check  main  3s  not enough free cores',
			'🚧 audit  .app-kit-lanes/12  0s  not enough free memory',
		])
	})

	it('draws nothing while no claim waits', () => {
		expect(run_board_render_waits.wait_lines([], linked)).toStrictEqual([])
		expect(run_board_render_waits.wait_lines(undefined, linked)).toStrictEqual([])
	})

	it('draws an icon no phase, state or header line already uses', () => {
		const { HEADER_ICONS, PHASE_ICONS, STATE_ICONS } = run_board_labels
		const icons = [HEADER_ICONS, PHASE_ICONS, STATE_ICONS].flatMap((table) => Object.values(table))

		expect(icons).not.toContain(run_board_render_waits.BUDGET_ICON)
	})
})

describe('run_board_render.render — the waiting claims under the header', () => {
	it('draws the waiting claims on the board', () => {
		const lines = lines_of(header({ budget_waits: WAITS }))

		expect(lines).toContain('🚧 gate lint  3943  12s  memory under pressure')
	})

	it('draws no waiting line on a board with none', () => {
		const lines = lines_of(header())

		expect(lines.some((line) => line.startsWith(run_board_render_waits.BUDGET_ICON))).toBe(false)
	})
})
