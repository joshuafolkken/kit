import { describe, expect, it } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { SessionOperations } from './run-board-operation-read'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spot } from './run-board-spot'

// joshuafolkken/kit#3757: the header's third line draws the newest operation of a child the board
// draws as running, the same on a screen and in a chat. joshuafolkken/kit#3767: its spinner under the
// `⏰`, its time in its format under its digits, its kind's icon under the `💪`, and the
// child's newest event where that is newer than its newest operation. joshuafolkken/kit#8475: the
// second line leaves the cell under the `⏰` blank while the run runs.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const SECOND = 1000
const THIRD = 2
// No kit version and no repository are read, so the name column draws `-` under the board's name and
// is blank on the third line.
const NAME = '▶ josh-board'
const NAME_BLANK = ' '.repeat(NAME.length)
const VERSION_CELL = '  -'.padEnd(NAME.length)
const TIME_BLANK = ' '.repeat('⏰ 2°10′00″'.length + 1)
const MACHINE_LINE = `${VERSION_CELL}  ${TIME_BLANK}  💪 -  🧠 -  💾 -  —`
const GATE_TEXT = '🔧 #7 · Bash pnpm josh gate'
// The third line with no spinner turning: its place blank, two columns wide as the `⏰`.
const STILL_LINE = `${NAME_BLANK}           4″  ${GATE_TEXT}`
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

	it('lines the spinner up under the ⏰, the time under its digits, the icon under 💪', () => {
		expect(header_lines_of({ operations: OPERATIONS, spinner: '⠙' })).toStrictEqual([
			`${NAME}  ⏰ 2°10′00″  ✅  1/2 ■■■■■─────  🔄 1  💤 0`,
			MACHINE_LINE,
			`${NAME_BLANK}  ⠙        4″  ${GATE_TEXT}`,
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
			`${NAME_BLANK}  ⠙        1″  🚦 #7 · ship gate`,
		)
	})

	it('counts the running children where no operation was read', () => {
		expect(third_of({}).trim()).toBe('🔄 1 running')
	})
})

// joshuafolkken/kit#8482: the root checkout's single run beside the lanes weighs in with their newest.
describe('run_board_header.header_lines with a root checkout’s single run', () => {
	const ROOT_ISSUE = 12

	function root_layout(state: BoardRow['state']): BoardLayout {
		return { ...LAYOUT, root: { name: 'fullrun', row: row(ROOT_ISSUE, state) } }
	}

	function with_root(age_ms: number): SessionOperations {
		const operation = { kind: 'Read', target: 'run-hold.ts', at_ms: NOW - age_ms } as const

		return { ...OPERATIONS, lanes: [...OPERATIONS.lanes, { issue: ROOT_ISSUE, operation }] }
	}

	it('writes the running single run’s operation where it is newer than the lanes’', () => {
		const third = third_of({ layout: root_layout('running'), operations: with_root(2 * SECOND) })

		expect(third).toBe(`${NAME_BLANK}           2″  🔧 #12 · Read run-hold.ts`)
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
