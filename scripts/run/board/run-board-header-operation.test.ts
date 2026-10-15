import { describe, expect, it } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { SessionOperations } from './run-board-operation-read'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#3757: the header's third line draws the newest operation of a child the board
// draws as running, the same on a screen and in a chat. joshuafolkken/kit#3767: its spinner under the
// `⏰` and `💓`, its time in their format under their digits, its kind's icon under the `⚡`, and the
// child's newest event where that is newer than its newest operation.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const SECOND = 1000
const THIRD = 2
// No repository is named, so the name column is blank past the first line.
const NAME_BLANK = ' '.repeat('▶ backlogrun'.length)
const BEAT_LINE = `${NAME_BLANK}  💓 0:01:00  ⚡ -  🧠 -  💾 -`
const GATE_TEXT = '🔧 #7 · Bash pnpm josh gate'
// The third line with no spinner turning: its place blank, two columns wide as the `💓`.
const STILL_LINE = `${NAME_BLANK}     0:00:04  ${GATE_TEXT}`
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

function header_lines_of(extra: Partial<BoardHeader>): Array<string> {
	return lines_of(header({ layout: LAYOUT, ...extra })).slice(0, THIRD + 1)
}

function third_of(extra: Partial<BoardHeader>): string {
	return header_lines_of(extra)[THIRD] ?? ''
}

describe('run_board_header.header_lines with a session’s operation', () => {
	it('writes the running child’s newest operation, not a settled child’s lane', () => {
		expect(third_of({ operations: OPERATIONS })).toBe(STILL_LINE)
	})

	it('lines the spinner up under the ⏰ and 💓, the time under their digits, the icon under ⚡', () => {
		expect(header_lines_of({ operations: OPERATIONS, spinner: '⠙' })).toStrictEqual([
			'▶ backlogrun  ⏰ 2:10:00  ✅  1/2 ■■■■■─────  🔄 1  ⏳ 0  💤 0',
			BEAT_LINE,
			`${NAME_BLANK}  ⠙  0:00:04  ${GATE_TEXT}`,
		])
	})

	it('leaves the spinner’s place blank in a chat, which draws no spinner', () => {
		expect(third_of({ operations: OPERATIONS, form: 'chat' })).toBe(STILL_LINE)
	})

	it('writes the child’s newest event where it is newer than the child’s newest operation', () => {
		const lane = { phase: 'gate', words: 'ship gate', at_ms: NOW - SECOND } as const
		const activity = {
			last_event_ms: NOW - MINUTE,
			is_stopped: false,
			lane_events: new Map([[7, lane]]),
		}

		expect(third_of({ operations: OPERATIONS, activity, spinner: '⠙' })).toBe(
			`${NAME_BLANK}  ⠙  0:00:01  🚦 #7 · ship gate`,
		)
	})

	it('counts the running children where no operation was read', () => {
		expect(third_of({}).trim()).toBe('🔄 1 running')
	})
})

describe('run_board_header.now_legend', () => {
	it('names the operation’s icon for the legend, and none where the line’s words name it', () => {
		expect(run_board_header.now_legend(header({ layout: LAYOUT, operations: OPERATIONS }))).toBe(
			'🔧 operation',
		)
		expect(run_board_header.now_legend(header({ layout: LAYOUT }))).toBeUndefined()
	})
})
