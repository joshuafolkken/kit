import { stripVTControlCharacters } from 'node:util'
import { NEEDS_HUMAN_MERGE_LABEL } from '#scripts/issue/issue-labels'
import { lane_spent } from '#scripts/lane/lane-spent'
import { lane_state } from '#scripts/lane/lane-state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardPlan } from './run-board-layout'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'
import { run_board_tick } from './run-board-tick'

const { CARRY, ENDED_AT, arrange } = run_board_read_fixture
const WORKING = '3432'
const ISSUE = Number(WORKING)
const REPO = 'joshuafolkken/kit'
const LABELS = [NEEDS_HUMAN_MERGE_LABEL]
const TITLE = 'Occupied worker'
const SECTION_PARTS = 2
const PLAN: BoardPlan = {
	waves: {
		waves: [],
		unreached: [{ number: ISSUE, repo: REPO, state: 'OPEN', labels: LABELS, blocked_by: [] }],
		running: [],
	},
	tracked: new Map(),
	context: { repo: REPO, titles: new Map([[ISSUE, TITLE]]), open_numbers: new Set([ISSUE]) },
	labels: new Map([[ISSUE, LABELS]]),
	human_merge_prs: new Map([[ISSUE, 1]]),
}

function arrange_lane(kind: 'current' | 'earlier' | 'unknown'): void {
	arrange({ kind: 'carried', carry: CARRY }, undefined)
	if (kind === 'unknown') return
	const launched_at = kind === 'current' ? ENDED_AT : '2026-10-08T09:00:00.000Z'

	vi.mocked(lane_state.read_states).mockResolvedValue(
		new Map([
			[
				WORKING,
				{
					issue: WORKING,
					state: 'running',
					changed_at: ENDED_AT,
					changed_by: 'lane:dispatch',
					launched_at,
				},
			],
		]),
	)
}

async function frame_of(): Promise<string> {
	const local = await run_board_read.read_local()
	if (local === undefined) throw new Error('Missing local read')
	const { ports, frames } = run_board_fixture.harness(local, [PLAN])

	expect(local.occupied_lanes).toHaveLength(local.occupied_count ?? 0)
	await run_board_tick.tick(run_board_tick.FRESH_STATE, { ...ports, form: 'chat' })

	return stripVTControlCharacters(frames.at(-1) ?? '')
}

afterEach(() => vi.restoreAllMocks())

function lane_section(frame: string): string {
	return frame.split('🧵 lanes', SECTION_PARTS)[1]?.split('\n\n', 1)[0] ?? ''
}

describe('human merge workers sharing the board occupancy snapshot', () => {
	it.each(['current', 'earlier', 'unknown'] as const)(
		'keeps an occupied %s worker in lanes (ac-eff23bf2) (ac-5e685f6f)',
		async (kind) => {
			arrange_lane(kind)
			const frame = await frame_of()
			const rows = frame.split('\n').filter((line) => line.includes(TITLE))

			expect(rows).toHaveLength(1)
			expect(rows[0]).toContain(WORKING)
			expect(lane_section(frame)).toContain(TITLE)
			expect(frame).not.toContain('🔏')
			expect(frame).not.toContain('PR 1')
		},
	)

	it('moves a worker that released its seat into waiting only (ac-5e685f6f)', async () => {
		arrange_lane('current')
		vi.mocked(lane_spent.idle_lanes).mockReturnValue([WORKING])
		const frame = await frame_of()
		const rows = frame.split('\n').filter((line) => line.includes(TITLE))

		expect(rows).toHaveLength(1)
		expect(rows[0]).toContain('🔏')
		expect(rows[0]).toContain('PR 1')
		expect(lane_section(frame)).not.toContain(TITLE)
	})
})
