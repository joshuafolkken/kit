import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { RowReason } from './run-board-layout'
import type { MachineGauges } from './run-board-machine'
import { run_board_reason, type ReasonRead } from './run-board-reason'

// The machine's room a judged, unblocked row waits on once nothing ahead of it holds it: a free lane,
// then the account's usage limit, then memory for one more lane — the order `backlog:drive` asks.

const REPO = 'joshuafolkken/kit'
const HELD = 3714
const NO_LANE_LEFT = 0
const ONE_LANE_LEFT = 1
const NOW_MS = Date.parse('2026-10-25T16:00:00.000Z')
const { WAIT_ICONS } = run_board_labels
const NO_LANE_REASON: RowReason = { icon: WAIT_ICONS.lane }

const ROW: EpicChild = {
	number: HELD,
	repo: REPO,
	state: 'OPEN',
	labels: [RUN_LANE_LABEL],
	blocked_by: [],
}

function reason(extra: Partial<ReasonRead>): RowReason | undefined {
	const read: ReasonRead = {
		plan: {
			waves: { waves: [[ROW]], unreached: [] },
			tracked: new Map(),
			context: { repo: REPO, titles: new Map(), open_numbers: new Set([HELD]) },
			labels: new Map(),
		},
		statuses: new Map(),
		events: [],
		free_lanes: ONE_LANE_LEFT,
		is_stopped: false,
		now_ms: NOW_MS,
		...extra,
	}

	return run_board_reason.reader(read)(ROW, [])
}

// joshuafolkken/kit#4084: a row the driver holds for memory says so, with the figures it was held on.
const PRESSED: MachineGauges = {
	cpu_percent: undefined,
	memory_percent: 88,
	swap_mb_per_s: 12,
	memory_pressure: undefined,
}

describe('run_board_reason.reader — a row the machine’s memory keeps waiting', () => {
	it('leads with 🧠 and its figure, and leaves the 💾 figure to the row’s end', () => {
		expect(reason({ is_memory_held: true, gauges: PRESSED })).toStrictEqual({
			icon: WAIT_ICONS.memory,
			value: '88%',
			tail: '💾 12M/s',
		})
	})

	it('draws no figure where none was read', () => {
		expect(reason({ is_memory_held: true })).toStrictEqual({
			icon: WAIT_ICONS.memory,
			value: undefined,
			tail: undefined,
		})
	})

	it('leads with 🧵 first when the lanes are full as well', () => {
		const full = { is_memory_held: true, gauges: PRESSED, free_lanes: NO_LANE_LEFT }

		expect(reason(full)).toStrictEqual(NO_LANE_REASON)
	})
})

// joshuafolkken/kit#4796: a row a Claude usage limit keeps waiting names the limit and when it resets.
const RESET_MS = Date.parse('2026-10-25T16:30:00.000Z')

describe('run_board_reason.reader — a row a usage limit keeps waiting', () => {
	it('leads with 🪫 and the reset in local time where a lane is free', () => {
		expect(reason({ usage_reset_ms: RESET_MS })).toStrictEqual({
			icon: WAIT_ICONS.usage_limit,
			value: run_board_labels.day_minute_of(RESET_MS),
		})
	})

	it('comes before the memory hold, as the driver asks them', () => {
		const held = { usage_reset_ms: RESET_MS, is_memory_held: true, gauges: PRESSED }

		expect(reason(held)?.icon).toBe(WAIT_ICONS.usage_limit)
	})

	it('leads with 🧵 over the limit when the lanes are full', () => {
		const full = { usage_reset_ms: RESET_MS, free_lanes: NO_LANE_LEFT }

		expect(reason(full)).toStrictEqual(NO_LANE_REASON)
	})

	it('says nothing of a limit once no reset is held', () => {
		expect(reason({ usage_reset_ms: undefined })).toBeUndefined()
	})
})
