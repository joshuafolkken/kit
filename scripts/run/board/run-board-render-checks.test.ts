import { styleText } from 'node:util'
import type { PrChecks } from '#scripts/run/event/run-event-checks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import type { Phase } from './run-board-phase'
import { run_board_render_checks } from './run-board-render-checks'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_tail } from './run-board-render-tail'

// joshuafolkken/kit#3770: a row in followup ends on its pull request's checks in place of its newest
// activity; a count of none is left out, a failure red and a rate limit yellow.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const CHECKS: PrChecks = { pr: 3765, pass: 6, pending: 2, fail: 0, coderabbit: 'running' }
const LIMITED: PrChecks = { ...CHECKS, coderabbit: 'rate-limited' }
const DRAWN = 'PR 3765  ✓ 6  ⏳ 2  🐰 ⏳'
const LEGEND_CODERABBIT = '🐰 CodeRabbit'
const LEGEND_RATE_LIMITED = '🐰 CodeRabbit (⛔ rate-limited)'

function running(phase: Phase): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - MINUTE,
		track: [phase],
		phase_ms: NOW - MINUTE,
	}

	return { number: 3754, title: 'Issue', kind: undefined, state: 'running', status, waits: [] }
}

function angled(number: number): string {
	return `<${String(number)}>`
}

function board(checks: PrChecks = CHECKS): BoardHeader {
	const activity = { last_event_ms: NOW, is_stopped: false, pr_checks: new Map([[3754, checks]]) }

	return header({ activity })
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_render_checks.checks_part', () => {
	it('draws the pull request, each count of some and CodeRabbit’s state', () => {
		expect(run_board_render_checks.checks_part(CHECKS, String)).toBe(DRAWN)
	})

	it('leaves out CodeRabbit where it has no check', () => {
		expect(run_board_render_checks.checks_part({ ...CHECKS, coderabbit: 'none' }, String)).toBe(
			'PR 3765  ✓ 6  ⏳ 2',
		)
	})

	// joshuafolkken/kit#4625: the number opens the pull request; `PR` stays plain.
	it('links only the pull request’s number', () => {
		expect(run_board_render_checks.checks_part(CHECKS, angled)).toBe('PR <3765>  ✓ 6  ⏳ 2  🐰 ⏳')
	})

	it('draws a failure red and a rate limit yellow', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const checks: PrChecks = { ...LIMITED, pending: 0, fail: 1 }

		expect(run_board_render_checks.checks_part(checks, String)).toBe(
			`PR 3765  ✓ 6  ${styleText('red', '✗ 1')}  ${styleText('yellow', '🐰 ⛔')}`,
		)
	})
})

describe('run_board_render_tail.tail_of in followup', () => {
	it('ends a followup row on its checks', () => {
		expect(run_board_render_tail.tail_of(running('followup'), board())[0]).toBe(DRAWN)
	})

	it('leaves a row in any other phase on its newest activity', () => {
		const row = running('review')

		expect(run_board_render_tail.tail_of(row, board())[0]).toBe('')
		expect(run_board_render_tail.checks_of(row, board())).toBeUndefined()
	})
})

// joshuafolkken/kit#4047: only the marks some row's checks draw.
describe('run_board_render_checks.legend_of', () => {
	it('names only the marks the parts draw, CodeRabbit’s among them', () => {
		const failing: PrChecks = { ...CHECKS, pass: 0, pending: 0, fail: 1, coderabbit: 'done' }

		expect(run_board_render_checks.legend_of([CHECKS])).toStrictEqual([
			'✓ ⏳ checks passed · pending',
			LEGEND_CODERABBIT,
		])
		expect(run_board_render_checks.legend_of([failing])).toStrictEqual([
			'✓ ✗ checks passed · failed',
			LEGEND_CODERABBIT,
		])
	})

	it('names the rate limit only while CodeRabbit draws it, and CodeRabbit only while it has a check', () => {
		const quiet: PrChecks = { ...CHECKS, pending: 0, coderabbit: 'none' }

		expect(run_board_render_checks.legend_of([LIMITED]).at(-1)).toBe(LEGEND_RATE_LIMITED)
		expect(run_board_render_checks.legend_of([quiet])).toStrictEqual(['✓ checks passed'])
		expect(run_board_render_checks.legend_of([])).toStrictEqual([])
	})
})

describe('the legend names the checks', () => {
	it('names them once a followup row draws them, and not before', () => {
		const layout = { ...EMPTY_LAYOUT, active: [running('followup')] }
		const quiet = { ...EMPTY_LAYOUT, active: [running('review')] }

		expect(lines_of({ ...board(), layout }).join('\n')).toContain(LEGEND_CODERABBIT)
		expect(lines_of({ ...board(), layout: quiet }).join('\n')).not.toContain(LEGEND_CODERABBIT)
	})
})
