import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import type { Phase } from './run-board-phase'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_tail } from './run-board-render-tail'

// joshuafolkken/kit#5563: a running lane whose phase ran past its share of a lane's
// 30-minute budget ends on `over budget +N′`; one within it, or in a phase with no budget, ends
// without it.

const { MINUTE, NOW, header } = run_board_render_fixture
const OVER = 'over budget +8′'

// Row 2 at `phase` for `minutes`.
function at_phase(phase: Phase, minutes: number): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - 30 * MINUTE,
		track: [phase],
		phase_ms: NOW - minutes * MINUTE,
	}

	return { number: 2, title: 'Issue 2', kind: undefined, state: 'running', status, waits: [] }
}

function tail(row: BoardRow): Array<string> {
	return run_board_render_tail.tail_of(row, header())
}

describe('run_board_render_tail.tail_of stage budget', () => {
	it('ends a running row whose phase ran past its budget on the minutes over', () => {
		expect(tail(at_phase('implement', 20)).at(-1)).toBe(OVER)
	})

	it('counts the ship phases against the ship budget', () => {
		expect(tail(at_phase('gate', 18)).at(-1)).toBe(OVER)
	})

	it('draws nothing for a phase within its budget or with none', () => {
		expect(tail(at_phase('implement', 12))).not.toContain(OVER)
		expect(tail(at_phase('report', 60)).join(' ')).not.toContain('over budget')
	})
})
