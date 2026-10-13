import { describe, expect, it } from 'vitest'
import type { BoardHeader } from './run-board-header'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { SessionOperations } from './run-board-operation-read'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#3757: the header's third line draws the newest operation of a child the board
// draws as running, the same on a screen and in a chat.

const { EMPTY_LAYOUT, NOW, header, lines_of } = run_board_render_fixture
const SECOND = 1000
const THIRD = 2
const GATE_LINE = '#7 · Bash pnpm josh gate  0:04'
const OPERATIONS: SessionOperations = {
	lanes: [
		{ issue: 7, operation: { kind: 'Bash', target: 'pnpm josh gate', at_ms: NOW - 4 * SECOND } },
		{ issue: 9, operation: { kind: 'Bash', target: 'pnpm josh ship', at_ms: NOW - SECOND } },
	],
	owner: undefined,
	judgment: undefined,
}

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

// Issue 7 running; issue 9 merged, its lane not yet collected.
const LAYOUT: BoardLayout = { ...EMPTY_LAYOUT, active: [row(7, 'running'), row(9, 'merged')] }

function third_of(extra: Partial<BoardHeader>): string {
	return (lines_of(header({ layout: LAYOUT, ...extra }))[THIRD] ?? '').trim()
}

describe('run_board_header.header_lines with a session’s operation', () => {
	it('writes the running child’s newest operation, not a settled child’s lane', () => {
		expect(third_of({ operations: OPERATIONS })).toBe(GATE_LINE)
	})

	it('writes the same line in a chat', () => {
		expect(third_of({ operations: OPERATIONS, form: 'chat' })).toBe(GATE_LINE)
	})

	it('counts the running children where no operation was read', () => {
		expect(third_of({})).toBe('1 running')
	})
})
