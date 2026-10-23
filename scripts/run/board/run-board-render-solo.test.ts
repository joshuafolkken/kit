import { stripVTControlCharacters } from 'node:util'
import type { BudgetWait } from '#scripts/gate/core-wait'
import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_lead } from './run-board-render-lead'

// joshuafolkken/kit#4625: a `run:solo` lane row draws 🧍 in its indent, every column after it where a
// row that is not solo draws its own, and the legend names 🧍 only while such a row is drawn.

const { EMPTY_LAYOUT, MINUTE, NOW, board_usage, header, lines_of } = run_board_render_fixture
const { LANE_INDENT } = run_board_render_lead
const SOLO_ICON = '🧍'
const SOLO_LEGEND = '🧍 runs alone'
const RUNNING = 4001
const HELD = 4002

function running(number: number, is_solo: boolean): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - 15 * MINUTE,
		track: ['implement' as const],
		phase_ms: NOW - 11 * MINUTE,
	}

	return {
		number,
		title: `Issue ${String(number)}`,
		kind: undefined,
		state: 'running',
		status,
		waits: [],
		reason: undefined,
		...(is_solo && { is_solo }),
	}
}

// A frame with a running lane and a lane held for its budget, both solo or neither.
function frame(is_solo: boolean): Array<string> {
	const hold: BudgetWait = {
		command: 'lint:related',
		lane: String(HELD),
		elsewhere: undefined,
		waited_ms: 9000,
		reason: 'pressure',
	}
	const active = [running(RUNNING, is_solo), running(HELD, is_solo)]
	const layout = { ...EMPTY_LAYOUT, active }
	const usages = board_usage(new Map())
	const lines = lines_of(header({ layout, budget_waits: [hold], usages, spinner: '⠋' }))

	return lines.map((line) => stripVTControlCharacters(line))
}

function line_of(lines: ReadonlyArray<string>, number: number): string {
	return lines.find((line) => line.includes(`Issue ${String(number)}`)) ?? ''
}

describe('run_board_render.render solo lane rows', () => {
	const solo = frame(true)
	const plain = frame(false)

	it('leads a solo lane row with 🧍 in place of its indent', () => {
		expect(line_of(solo, RUNNING).startsWith(SOLO_ICON)).toBe(true)
		expect(line_of(solo, HELD).startsWith(`${SOLO_ICON}🚧`)).toBe(true)
		expect(line_of(plain, RUNNING).startsWith(LANE_INDENT)).toBe(true)
	})

	it('draws a solo row as the same row not solo draws it, but for 🧍', () => {
		for (const number of [RUNNING, HELD]) {
			const line = line_of(solo, number)

			expect(`${LANE_INDENT}${line.slice(SOLO_ICON.length)}`).toBe(line_of(plain, number))
		}
	})

	it('names 🧍 in the legend only while a solo lane row is drawn', () => {
		expect(solo.filter((line) => line.includes(SOLO_LEGEND))).toHaveLength(1)
		expect(plain.join('\n')).not.toContain(SOLO_LEGEND)
	})
})
