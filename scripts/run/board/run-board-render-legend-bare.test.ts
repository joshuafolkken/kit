import { describe, expect, it } from 'vitest'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { SessionOperations } from './run-board-operation-read'
import type { Phase } from './run-board-phase'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#4173: the legend names only an icon the frame draws with no word beside it, so each
// icon it names is drawn somewhere else on the board, and never there beside the legend's word.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const GAP = '  '
const LEGEND = [
	'🚢 ship',
	'🚦 gate',
	'🔧 operation',
	'⏰ elapsed',
	'🎯 estimated finish',
	'💤 parked',
	'🏁 done',
	'✨ feature',
	'🐛 fix',
	'🔗 waits on',
].join(GAP)
const USUAL = new Map<Phase, number>([
	['ship', 20 * MINUTE],
	['gate', 20 * MINUTE],
])
const OPERATIONS: SessionOperations = {
	lanes: [{ issue: 1, operation: { kind: 'Bash', target: 'pnpm josh ship', at_ms: NOW - MINUTE } }],
	owner: undefined,
	judgment: undefined,
}

function row(number: number, extra: Partial<BoardRow>): BoardRow {
	return {
		number,
		title: undefined,
		kind: undefined,
		state: 'waiting',
		status: undefined,
		waits: [],
		...extra,
	}
}

function running(number: number, phase: Phase): BoardRow {
	const status = { state: 'running' as const, track: [phase], phase_ms: NOW - 5 * MINUTE }

	return row(number, { state: 'running', status })
}

// Two children shipping and gating, one parked feature, one closed unmerged, and a fix queued behind
// the parked one.
const LAYOUT: BoardLayout = {
	...EMPTY_LAYOUT,
	active: [
		running(1, 'ship'),
		running(2, 'gate'),
		row(3, { state: 'parked', kind: 'enhancement' }),
		row(5, { state: 'done' }),
	],
	queued: [
		{
			kind: 'row',
			row: row(4, { kind: 'bug', waits: ['3'], reason: { icon: '🔗', issues: ['3'] } }),
		},
	],
}

function board_of(): Array<string> {
	const beating = { last_event_ms: NOW - MINUTE, is_stopped: false }

	return lines_of(
		header({
			activity: beating,
			layout: LAYOUT,
			usual: USUAL,
			lane_limit: 2,
			operations: OPERATIONS,
		}),
	)
}

describe('run_board_render.render legend icons drawn bare', () => {
	const lines = board_of()
	const board = lines.slice(0, -1).join('\n')

	it('names on one line only the icons drawn with no word beside them', () => {
		expect(lines.at(-1)).toBe(LEGEND)
	})

	it('draws each icon the legend names elsewhere on the board, never beside the legend’s word', () => {
		for (const entry of LEGEND.split(GAP)) {
			const [icon = ''] = entry.split(' ', 1)

			expect(board).toContain(icon)
			expect(board).not.toContain(entry)
		}
	})

	// joshuafolkken/kit#4538: the estimated finish once shared 🏁 with a done row.
	it('gives each icon it names one meaning', () => {
		const icons = (lines.at(-1) ?? '').split(GAP).map((entry) => entry.split(' ', 1)[0])

		expect(new Set(icons).size).toBe(icons.length)
	})
})
