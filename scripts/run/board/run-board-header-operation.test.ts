import { describe, expect, it } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { SessionOperations } from './run-board-operation-read'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spot } from './run-board-spot'

// joshuafolkken/kit#3757: the header's third line draws the newest operation of a child the board
// draws as running, the same on a screen and in a chat. joshuafolkken/kit#3767: its spinner under the
// `⏰`, its time in its format under its digits, its kind's icon under the `💪`, and the
// child's newest event where that is newer than its newest operation. joshuafolkken/kit#8478: the
// time circuits — the third line's spinner in the signs' column under `-` and `+`, its time under
// their digits, after the start clock.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header, lines_of } = run_board_render_fixture
const SECOND = 1000
const THIRD = 2
// No kit version and no repository are read, so the name column draws `-` under the board's name and
// is blank on the third line; the column is at least 15 columns (joshuafolkken/kit#8917).
const NAMES_WIDTH = 15
const NAME = '▶ josh-board'.padEnd(NAMES_WIDTH)
const NAME_BLANK = ' '.repeat(NAMES_WIDTH)
const VERSION_CELL = '  -'.padEnd(NAMES_WIDTH)
const START = `🚀 ${run_board_labels.minute_of(STARTED)}`
const FIRST_LINE = `${NAME}  🎯 --:--  -  --′--″  💪 -  🧠 -  💾 -`
const SECOND_LINE = `${VERSION_CELL}  🕒 ${run_board_labels.minute_of(NOW)}  +2°10′00″  —`
const GATE_TEXT = '🔧 #7 · Bash pnpm josh gate'
const THIRD_HEAD = `${NAME_BLANK}  ${START}  `
// The third line with no spinner turning: its place in the signs' column blank.
const STILL_LINE = `${THIRD_HEAD}       4″  ${GATE_TEXT}`
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

// The header's first three lines as written, the sweep's placeholder (joshuafolkken/kit#8240) drawn back.
function header_lines_of(extra: Partial<BoardHeader>): Array<string> {
	return lines_of(header({ layout: LAYOUT, ...extra }))
		.slice(0, THIRD + 1)
		.map((line) => run_board_spot.drawn(line, extra.spinner ?? ''))
}

function third_of(extra: Partial<BoardHeader>): string {
	return header_lines_of(extra)[THIRD] ?? ''
}

describe('run_board_header.header_lines with a session’s operation', () => {
	it('writes the running child’s newest operation, not a settled child’s lane', () => {
		expect(third_of({ operations: OPERATIONS })).toBe(STILL_LINE)
	})

	it('lines the spinner up under the signs, the time under their digits, the icon under 💪', () => {
		expect(header_lines_of({ operations: OPERATIONS, spinner: '⠙' })).toStrictEqual([
			FIRST_LINE,
			SECOND_LINE,
			`${THIRD_HEAD}⠙      4″  ${GATE_TEXT}`,
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
			`${THIRD_HEAD}⠙      1″  🚦 #7 · ship gate`,
		)
	})

	it('counts the running children where no operation was read', () => {
		expect(third_of({})).toBe(`${THIRD_HEAD}${' '.repeat(9)}  🔄 1 running`)
	})
})

// joshuafolkken/kit#8482: the root checkout's single run beside the lanes weighs in with their newest.
describe('run_board_header.header_lines with a root checkout’s single run', () => {
	const ROOT_ISSUE = 12

	function root_layout(state: BoardRow['state']): BoardLayout {
		return { ...LAYOUT, singles: [{ name: 'fullrun', row: row(ROOT_ISSUE, state) }] }
	}

	function with_root(age_ms: number): SessionOperations {
		const operation = { kind: 'Read', target: 'run-hold.ts', at_ms: NOW - age_ms } as const

		return { ...OPERATIONS, lanes: [...OPERATIONS.lanes, { issue: ROOT_ISSUE, operation }] }
	}

	it('writes the running single run’s operation where it is newer than the lanes’', () => {
		const third = third_of({ layout: root_layout('running'), operations: with_root(2 * SECOND) })

		expect(third).toBe(`${THIRD_HEAD}       2″  🔧 #12 · Read run-hold.ts`)
	})

	it('keeps the lane’s operation where the single run’s is older', () => {
		const third = third_of({ layout: root_layout('running'), operations: with_root(MINUTE) })

		expect(third).toBe(STILL_LINE)
	})

	it('reads no operation of a single run not drawn as running', () => {
		const third = third_of({ layout: root_layout('stopped'), operations: with_root(SECOND) })

		expect(third).toBe(STILL_LINE)
	})
})

// joshuafolkken/kit#8103: where the board types rows, the third line's words carry a key of their own.
describe('run_board_header — the third line’s key', () => {
	const GATE_KEY = 'now:#7 · Bash pnpm josh gate'

	it('keys the words after the time, the line drawn as it is without the key', () => {
		const keyed = { operations: OPERATIONS, is_keyed: true }
		const split = run_board_row_key.split_key(third_of(keyed))

		expect(split.key).toBe(GATE_KEY)
		expect(split.text).toBe(STILL_LINE)
		expect(run_board_header.now_key(header({ layout: LAYOUT, ...keyed }))).toBe(GATE_KEY)
	})

	it('keys no now line where the third line names no words, nor where the board types no rows', () => {
		const empty = header({ is_keyed: true })

		expect(run_board_header.now_key(empty)).toBeUndefined()
		// joshuafolkken/kit#8457: the progress line carries a key of its own.
		expect(
			lines_of(empty).every(
				(line) => run_board_row_key.split_key(line).key?.startsWith('now:') !== true,
			),
		).toBe(true)
		expect(third_of({ operations: OPERATIONS })).toBe(STILL_LINE)
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
