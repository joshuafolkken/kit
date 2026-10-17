import type { PrChecks } from '#scripts/run/event/run-event-checks'
import { describe, expect, it } from 'vitest'
import type { BoardHeader } from './run-board-header'
import type { LaneEvent } from './run-board-lane-event'
import type { BoardRow } from './run-board-layout'
import type { SessionOperations } from './run-board-operation-read'
import type { Phase } from './run-board-phase'
import { run_board_render_drawn } from './run-board-render-drawn'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#4047: the legend reads what the frame draws — the rows' leads, the header's third
// line, the rows' ends and a followup row's checks.

const { EMPTY_LAYOUT, MINUTE, NOW, header } = run_board_render_fixture
const LEADS = new Set(['🔨'])
const CHECKS: PrChecks = { pr: 3765, pass: 1, pending: 0, fail: 0, coderabbit: 'none' }

function running(phase: Phase): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - MINUTE,
		track: [phase],
		phase_ms: NOW - MINUTE,
	}

	return { number: 1, title: 'Issue', kind: undefined, state: 'running', status, waits: [] }
}

function board(row: BoardRow, extra: Partial<BoardHeader['activity']> = {}): BoardHeader {
	const event: LaneEvent = { phase: 'ship', words: 'ship preflight', at_ms: NOW - MINUTE }
	const lane_events = new Map([[1, event]])
	const activity = { last_event_ms: NOW, is_stopped: false, lane_events, ...extra }

	return header({ activity, layout: { ...EMPTY_LAYOUT, active: [row] } })
}

function operated(row: BoardRow): BoardHeader {
	const operation = { kind: 'Bash', target: 'pnpm', at_ms: NOW }
	const operations: SessionOperations = {
		lanes: [{ issue: 1, operation }],
		owner: undefined,
		judgment: undefined,
	}

	return { ...board(row), operations }
}

describe('run_board_render_drawn.drawn_of', () => {
	it('reads every icon a phase is drawn with: the leads and the newest activity', () => {
		const row = running('implement')
		const drawn = run_board_render_drawn.drawn_of(board(row), [row], LEADS)

		expect(drawn.icons).toStrictEqual(new Set(['🔨', '🚢']))
		expect(drawn.named).toStrictEqual([])
		expect(drawn.checks).toStrictEqual([])
	})

	it('names 🔧 where the frame draws an operation', () => {
		const row = running('implement')

		expect(run_board_render_drawn.drawn_of(operated(row), [row], LEADS).named).toContain(
			'🔧 operation',
		)
	})

	it('names a followup row’s checks', () => {
		const row = running('followup')
		const pr_checks = new Map([[1, CHECKS]])
		const drawn = run_board_render_drawn.drawn_of(board(row, { pr_checks }), [row], LEADS)

		expect(drawn.checks).toStrictEqual(['✓ checks passed'])
	})

	// The row's end draws its checks, so only the header's third line draws the event's 🚢.
	it('reads the header’s third line where no row’s end draws the phase', () => {
		const row = running('followup')
		const pr_checks = new Map([[1, CHECKS]])

		expect(
			run_board_render_drawn.drawn_of(board(row, { pr_checks }), [row], LEADS).icons,
		).toContain('🚢')
	})
})
