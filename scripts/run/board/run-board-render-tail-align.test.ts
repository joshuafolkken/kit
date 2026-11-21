import type { PrChecks } from '#scripts/run/event/run-event-checks'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import type { Phase } from './run-board-phase'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#7994: a running row's tail draws its finish before its newest activity, the finish's
// stamp left-aligned and its drift right-aligned across the frame, so the activity, the held check and
// the pull request's checks start in one column on every running row. joshuafolkken/kit#8478: the stamp
// draws no `~`.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
// Median 40′: the 5′ lane is on time, the 25′ one `+5′`, the 42′ one `+120′`, the 170′ one a day on.
const TOTALS = [10, 20, 30, 40, 45, 160, 2000].map((minutes) => minutes * MINUTE)
const OPERATED = '🔧'
const DRIFT_MARK = '′'
const CHECKS: PrChecks = { pr: 3765, pass: 6, pending: 2, fail: 0, coderabbit: 'none' }

// Every lane's number is four digits, as the board's are, so the rows' heads end in one column.
const LANE_BASE = 1000

// Lane `LANE_BASE + minutes`, titled `Issue <minutes>`, launched `minutes` ago, at `phase` for eight
// minutes.
function running(minutes: number, phase: Phase = 'implement'): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - minutes * MINUTE,
		track: [phase],
		phase_ms: NOW - 8 * MINUTE,
	}

	return {
		number: LANE_BASE + minutes,
		title: `Issue ${String(minutes)}`,
		kind: undefined,
		state: 'running',
		status,
		waits: [],
	}
}

// Each of `numbers` ran an operation a minute ago.
function operated(numbers: ReadonlyArray<number>): BoardHeader['operations'] {
	const operation = { kind: 'Bash', target: 'pnpm', at_ms: NOW - MINUTE }
	const lanes = numbers.map((issue) => ({ issue, operation }))

	return { lanes, owner: undefined, judgment: undefined }
}

function frame(rows: ReadonlyArray<BoardRow>, extra: Partial<BoardHeader> = {}): Array<string> {
	const operations = operated(rows.map(({ number }) => number))
	const layout = { ...EMPTY_LAYOUT, active: [...rows] }

	return lines_of(header({ layout, operations, lane_totals: TOTALS, ...extra }))
}

function line_of(lines: ReadonlyArray<string>, number: number): string {
	return lines.find((line) => line.includes(`Issue ${String(number)}`)) ?? ''
}

// The columns before the last `marker` on row `number`'s line, as the terminal counts them.
function column_of(lines: ReadonlyArray<string>, number: number, marker: string): number {
	const line = line_of(lines, number)

	return run_board_fit.width_of(line.slice(0, line.lastIndexOf(marker)))
}

function columns_of(
	lines: ReadonlyArray<string>,
	numbers: ReadonlyArray<number>,
	marker: string,
): Set<number> {
	return new Set(numbers.map((number) => column_of(lines, number, marker)))
}

describe('run_board_render.render — a running row’s finish before its activity', () => {
	it('draws the finish, then the newest activity', () => {
		const lines = frame([running(5)])

		expect(line_of(lines, 5)).toMatch(/🎯 \d{2}:\d{2} {2}🔧 1′00″$/u)
	})

	it('starts every activity in one column over mixed drifts, a day and a row with no finish', () => {
		const earlier: BoardRow = { ...running(7), is_earlier: true }
		const lines = frame([running(5), running(25), running(42), running(170), earlier])

		expect(columns_of(lines, [5, 25, 42, 170, 7], OPERATED).size).toBe(1)
		expect(line_of(lines, 170)).toMatch(/🎯 \d{2}-\d{2} \d{2}:\d{2}/u)
	})

	it('ends `+5′` and `+120′` in one column', () => {
		const lines = frame([running(25), running(42)])

		expect(line_of(lines, 25)).toContain('+5′')
		expect(line_of(lines, 42)).toContain('+120′')
		expect(columns_of(lines, [25, 42], DRIFT_MARK).size).toBe(1)
	})

	it('starts every activity in one column where no lane total is measured', () => {
		const lines = frame([running(5), running(25)], { lane_totals: [] })

		expect(line_of(lines, 5)).toMatch(/🎯 — {2}🔧 1′00″$/u)
		expect(columns_of(lines, [5, 25], OPERATED).size).toBe(1)
	})
})

describe('run_board_render.render — what a running row draws after its finish', () => {
	it('ends a row with no activity on its finish, with no trailing blank', () => {
		const quiet: BoardRow = {
			...running(5),
			status: { ...running(5).status, state: 'running', phase_ms: NOW },
		}
		const lines = frame([quiet, running(42)], { operations: operated([LANE_BASE + 42]) })
		const line = line_of(lines, 5)

		expect(line).toMatch(/🎯 \d{2}:\d{2}$/u)
		expect(line).toBe(line.trimEnd())
	})

	it('starts a held check and a followup row’s checks where the activity starts', () => {
		const held = {
			command: 'lint:related',
			lane: String(LANE_BASE + 25),
			elsewhere: undefined,
			waited_ms: 9000,
			reason: 'memory' as const,
		}
		const activity = {
			last_event_ms: NOW,
			is_stopped: false,
			pr_checks: new Map([[LANE_BASE + 42, CHECKS]]),
		}
		const lines = frame([running(5), running(25), running(42, 'followup')], {
			budget_waits: [held],
			activity,
		})

		expect(column_of(lines, 25, 'lint')).toBe(column_of(lines, 5, OPERATED))
		expect(column_of(lines, 42, 'PR 3765')).toBe(column_of(lines, 5, OPERATED))
	})
})
