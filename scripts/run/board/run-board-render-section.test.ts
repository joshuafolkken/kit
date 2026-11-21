import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_section } from './run-board-render-section'
import type { ItemState } from './run-board-status'

// joshuafolkken/kit#4042: the running and parked rows lead with no rule, the finished ones gather
// under `✅ done` after every other plan section, and the unreached rows wait under `🔗 waiting`.
// joshuafolkken/kit#4099: the rows waiting on a decision follow the leading rows under `🙋 decision`,
// then the findings under `📌 findings`, then `⏳ queued` (joshuafolkken/kit#4137), `🔗 waiting` and
// `✅ done`.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header, lines_of, note, rule } =
	run_board_render_fixture
const DECISION = '🙋 decision'

// A rule's start, whatever column the lane rows' titles run it on to.
function lead(label: string): string {
	return `── ${label} ─`
}

function row(number: number, state: ItemState, started_minute?: number): BoardRow {
	const started_ms = started_minute === undefined ? undefined : STARTED + started_minute * MINUTE
	const ended_ms = started_ms === undefined || state === 'running' ? undefined : started_ms + MINUTE
	const status = started_ms === undefined ? undefined : { state, started_ms, ended_ms }

	return { number, title: `Issue ${String(number)}`, kind: undefined, state, status, waits: [] }
}

const LAYOUT = {
	...EMPTY_LAYOUT,
	active: [
		row(1, 'running', 0),
		row(2, 'parked', 5),
		row(3, 'merged', 30),
		row(4, 'withdrawn', 20),
		row(5, 'done', 10),
	],
	queued: [{ kind: 'row' as const, row: row(8, 'waiting') }],
	people: [row(6, 'human')],
	unreached: [row(7, 'waiting')],
}

function index_of(lines: ReadonlyArray<string>, text: string): number {
	return lines.findIndex((line) => line.includes(text))
}

describe('run_board_render.render sections', () => {
	const lines = lines_of(header({ layout: LAYOUT }), [note(NOW, 'finding')])
	const order = [
		'Issue 1',
		'Issue 2',
		lead(DECISION),
		'Issue 6',
		lead('📌 findings 1'),
		'finding',
		lead('⏳ queued 1'),
		'Issue 8',
		lead('🔗 waiting 1'),
		'Issue 7',
		lead('✅ done 3'),
		'Issue 3',
		'Issue 4',
		'Issue 5',
	]

	it('draws the leading rows, the decisions, the findings, the plan’s rest and done in order', () => {
		const indexes = order.map((text) => index_of(lines, text))

		expect(indexes.every((index) => index !== -1)).toBe(true)
		expect(indexes).toStrictEqual(indexes.toSorted((left, right) => left - right))
	})

	it('draws every finished row and no fold line where no pane bounds the frame', () => {
		expect(lines.filter((line) => line.includes(' more'))).toStrictEqual([])
		expect(lines).not.toContain(rule('🔗'))
	})

	it('draws no findings rule where there are no notes', () => {
		const bare = lines_of(header({ layout: LAYOUT }), [])

		expect(bare.some((line) => line.includes('📌'))).toBe(false)
	})
})

const { ROW_INDENT, heading_lines, lone_head, open_head } = run_board_render_section
const { width_of } = run_board_fit
const HEAD = heading_lines(DECISION)
const RULE_LINE = HEAD.at(-1) ?? ''

function icon_column(line: string): number {
	return width_of(line.slice(0, line.indexOf('🙋')))
}

// joshuafolkken/kit#8257: every section's row starts in one column, and a live section drawn with no
// fold key leads with one rule, so its icon stands where an opened section's does.
describe('run_board_render_section row indent and lone heading', () => {
	it('starts every section’s row five columns in', () => {
		expect(width_of(ROW_INDENT)).toBe(5)
	})

	it('leads a live section with no fold key with one rule, its icon in the second column', () => {
		const lone = lone_head(HEAD, DECISION).at(-1) ?? ''

		expect(lone.startsWith(`─ ${DECISION} ─`)).toBe(true)
		expect(icon_column(lone)).toBe(icon_column(open_head(HEAD, DECISION).at(-1) ?? ''))
		expect(icon_column(lone)).toBe(2)
		expect(width_of(lone)).toBe(width_of(RULE_LINE))
	})

	it('leaves a chat’s decision heading on its `── ` lead', () => {
		const chat = lines_of(header({ layout: LAYOUT, form: 'chat' }), [])

		expect(chat.some((line) => line.startsWith(lead(DECISION)))).toBe(true)
	})
})
