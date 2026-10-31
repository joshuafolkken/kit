import { describe, expect, it } from 'vitest'
import { run_board_fit, type SectionKey } from './run-board-fit'
import type { BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#5520: every rule ends in the column the lane rows' titles end in, open, folded or
// drawn whole, and the counted sections say how many rows they hold while open.

const { EMPTY_LAYOUT, MINUTE, NOW, board_usage, header, note } = run_board_render_fixture
const { width_of } = run_board_fit
const TALL = 200
const WIDE = 300
const NARROW = 90
const LONG_TITLE = 'A lane title long enough that the board cuts it on an ellipsis'
const RULE_MARKS = ['── ', '▾ ', '▸ ']
const PHASE_AGE = 10 * MINUTE
// The least a narrowed lane title keeps (`run-board-render-title.ts` TITLE_FLOOR).
const TITLE_FLOOR = 8

function row(number: number, extra: Partial<BoardRow> = {}): BoardRow {
	return {
		number,
		title: `Issue ${String(number)}`,
		state: 'waiting',
		status: undefined,
		kind: undefined,
		waits: [],
		...extra,
	}
}

const LANE = row(5502, {
	title: LONG_TITLE,
	state: 'running',
	status: { state: 'running', started_ms: NOW, phase_ms: NOW - PHASE_AGE, track: ['implement'] },
})
// The lane's newest operation, drawn as a tail after its title.
const OPERATION = { kind: 'Bash', target: 'pnpm', at_ms: NOW - MINUTE }
const LAYOUT = {
	...EMPTY_LAYOUT,
	active: [LANE, row(5389, { state: 'merged' })],
	queued: [
		{ kind: 'row' as const, row: row(5509) },
		{ kind: 'row' as const, row: row(5506) },
	],
	unreached: [row(5285)],
}
const BOARD = header({
	layout: LAYOUT,
	occupied_count: 1,
	lane_limit: 4,
	usages: board_usage(new Map()),
	operations: {
		lanes: [{ issue: LANE.number, operation: OPERATION }],
		owner: undefined,
		judgment: undefined,
	},
})

function frame(folded?: ReadonlySet<SectionKey>, columns = WIDE): Array<string> {
	const size = folded === undefined ? undefined : { rows: TALL, columns }

	return run_board_render.render({ header: BOARD, notes: [note(NOW, 'seen')], size, folded })
}

function rules_of(lines: ReadonlyArray<string>): Array<string> {
	return lines.filter((line) => RULE_MARKS.some((mark) => line.startsWith(mark)))
}

// The column the lane row's cut title ends in, its ellipsis included.
function title_end(lines: ReadonlyArray<string>): number {
	const lane = lines.find((line) => line.includes(LONG_TITLE.slice(0, TITLE_FLOOR))) ?? ''

	return width_of(lane.slice(0, lane.indexOf('…') + 1))
}

describe('run_board_render rules', () => {
	it('ends every rule of a whole frame in the column the lane title ends in', () => {
		const lines = frame()
		const widths = rules_of(lines).map((line) => width_of(line))

		expect(widths.length).toBeGreaterThan(1)
		expect(new Set(widths)).toStrictEqual(new Set([title_end(lines)]))
	})

	it('ends the open ▾ rules and the folded ▸ rules in the same column', () => {
		const lines = frame(new Set(['queued']))
		const rules = rules_of(lines)

		expect(rules.some((line) => line.startsWith('▸ '))).toBe(true)
		expect(new Set(rules.map((line) => width_of(line)))).toStrictEqual(new Set([title_end(lines)]))
	})

	it('ends every rule where a narrow pane cuts the lane title', () => {
		const lines = frame(new Set(), NARROW)
		const widths = rules_of(lines).map((line) => width_of(line))

		expect(title_end(lines)).toBeLessThan(NARROW)
		expect(new Set(widths)).toStrictEqual(new Set([title_end(lines)]))
	})
})

describe('run_board_render counted rules', () => {
	it('says how many rows each counted section holds while it is open', () => {
		const rules = rules_of(frame())

		for (const label of ['📌 findings 1', '⏳ queued 2', '🔗 waiting 1', '✅ done 1']) {
			expect(rules.some((line) => line.startsWith(`── ${label} ─`))).toBe(true)
		}
	})

	it('keeps the count after the label on an open ▾ rule', () => {
		const rules = rules_of(frame(new Set()))

		expect(rules.some((line) => line.startsWith('▾ ⏳ queued 2 ─'))).toBe(true)
		expect(rules.some((line) => line.startsWith('▾ 📌 findings 1 ─'))).toBe(true)
	})
})
