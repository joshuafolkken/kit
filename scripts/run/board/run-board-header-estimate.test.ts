import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { Phase } from './run-board-phase'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#4044: the estimated finish stands right after the progress bar and before `🔄`, the
// `⏰`/`💓` and `✅`/`🧠` columns unmoved; a frame with no estimate draws neither it nor its legend.
// joshuafolkken/kit#7770: it draws the local finish time, from the lanes' dispatch-to-merge totals.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const LEGEND = '🎯 estimated finish'
const USUAL = new Map<Phase, number>([['implement', 20 * MINUTE]])
const TOTALS = [20 * MINUTE]
const BEATING = { last_event_ms: NOW - MINUTE, is_stopped: false }

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

// One child implementing for five minutes, one waiting in the wave after it.
const LAYOUT: BoardLayout = {
	...EMPTY_LAYOUT,
	active: [
		{
			...row(1, 'running'),
			status: {
				state: 'running',
				track: ['implement'],
				phase_ms: NOW - 5 * MINUTE,
				started_ms: NOW - 5 * MINUTE,
			},
		},
	],
	queued: [{ kind: 'row', row: row(2, 'waiting') }],
}

function lines_with(extra: Partial<BoardHeader> = {}): Array<string> {
	return lines_of(
		header({
			activity: BEATING,
			layout: LAYOUT,
			usual: USUAL,
			lane_totals: TOTALS,
			lane_limit: 1,
			...extra,
		}),
	)
}

// `🎯 ~HH:MM` for a finish `minutes` from now.
function estimate_at(minutes: number): string {
	return `🎯 ~${run_board_labels.minute_of(NOW + minutes * MINUTE)}`
}

// The column `text` starts in on `line`.
function start_of(line: string | undefined, text: string): number {
	const drawn = line ?? ''

	expect(drawn).toContain(text)

	return run_board_fit.width_of(drawn.slice(0, drawn.indexOf(text)))
}

describe('run_board_header.header_lines estimated finish', () => {
	it('draws 🎯 ~HH:MM after the bar and before 🔄', () => {
		const [first] = lines_with()

		// 15′ left of the running child, then 20′ for the waiting one on the one lane.
		expect(first).toMatch(new RegExp(`[■─] {2}${estimate_at(35)} {2}🔄 1`, 'u'))
	})

	// The machine line before a gauge is read leads with 💪, where a chat's leads with 🧠.
	it('keeps the ✅/💪 columns aligned', () => {
		const [first, second] = lines_with()

		expect(start_of(first, '✅')).toBe(start_of(second, '💪'))
	})

	// joshuafolkken/kit#4319: a 🔗 child waits for its blocker however many lanes are free.
	it('draws a dependency chain end to end', () => {
		const chain: BoardLayout = {
			...EMPTY_LAYOUT,
			queued: [
				{ kind: 'row', row: row(2, 'waiting') },
				{ kind: 'row', row: { ...row(3, 'waiting'), waits: ['2'] } },
			],
		}
		const [first] = lines_with({ layout: chain, lane_limit: 2 })

		expect(first).toContain(estimate_at(40))
	})

	it('draws no 🎯 without a lane total', () => {
		expect(lines_with({ lane_totals: [] })[0]).not.toContain('🎯')
	})

	it('draws no 🎯 before the plan is read', () => {
		expect(lines_with({ plan_fetched_ms: undefined })[0]).not.toContain('🎯')
	})

	it('draws no 🎯 or its legend for a stopped run', () => {
		const lines = lines_with({ activity: { ...BEATING, is_stopped: true } })

		expect(lines[0]).not.toContain('🎯')
		expect(lines.join('\n')).not.toContain(LEGEND)
	})
})

describe('run_board_render legend for the estimated finish', () => {
	it('names 🎯 on a frame that draws it', () => {
		expect(lines_with().join('\n')).toContain(LEGEND)
	})

	// A running row ends on 🎯 (joshuafolkken/kit#7920), so only a frame with none draws no 🎯.
	it('leaves 🎯 out of a frame that draws none', () => {
		const layout = { ...EMPTY_LAYOUT, queued: LAYOUT.queued }

		expect(lines_with({ lane_totals: undefined, layout }).join('\n')).not.toContain(LEGEND)
	})
})
