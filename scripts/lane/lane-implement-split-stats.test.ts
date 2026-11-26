import { describe, expect, it, vi } from 'vitest'
import type { Breakdown, lane_breakdown } from './lane-breakdown'
import { lane_implement_split } from './lane-implement-split'
import { lane_implement_split_stats } from './lane-implement-split-stats'
import type { lane_phases } from './lane-phases'

// joshuafolkken/kit#8998: `lane:breakdown --period <days>` prints each implement-split segment's
// median and run count over the lanes merged in the window.

const mocks = vi.hoisted(() => ({
	merged_in: vi.fn<typeof lane_phases.merged_in>(),
	breakdown_of: vi.fn<typeof lane_breakdown.of>(),
	of: vi.fn<typeof lane_implement_split.of>(),
	has_rows: vi.fn<typeof lane_implement_split.has_rows>(),
}))

vi.mock(import('./lane-phases'), async (import_original) => {
	const { lane_phases } = await import_original()

	return { lane_phases: { ...lane_phases, merged_in: mocks.merged_in } }
})
vi.mock(import('./lane-breakdown'), async (import_original) => {
	const { lane_breakdown } = await import_original()

	return { lane_breakdown: { ...lane_breakdown, of: mocks.breakdown_of } }
})
vi.mock(import('./lane-implement-split'), async (import_original) => {
	const { lane_implement_split: actual } = await import_original()

	return { lane_implement_split: { ...actual, has_rows: mocks.has_rows, of: mocks.of } }
})

const MINUTE_MS = 60_000
const DAYS = 14
const NOW_MS = Date.parse('2026-11-26T00:00:00.000Z')
const DAY_MS = 86_400_000
const { SEGMENT } = lane_implement_split

function split(edit: number, gate: number): Array<{ name: string; ms: number }> {
	return [
		{ name: SEGMENT.EDIT, ms: edit * MINUTE_MS },
		{ name: SEGMENT.GATE, ms: gate * MINUTE_MS },
	]
}

describe('lane_implement_split_stats.text', () => {
	it('prints each segment median over the runs that spent time on it', () => {
		const lines = lane_implement_split_stats
			.text([split(10, 0), split(20, 4), split(30, 6)], DAYS, 5)
			.split('\n')

		expect(lines[0]).toBe(
			'Implement split, lanes merged in the last 14 days: 3 of 5 split (the rest have no dispatch or split rows in the ledger)',
		)
		expect(lines).toContain('- editing (tests included): median 20.0 min, in 3 of 3 runs')
		expect(lines).toContain('- gate wait: median 5.0 min, in 2 of 3 runs')
		expect(lines).toContain('- review wait: median none, in 0 of 3 runs')
	})

	it('prints only the head line when no lane splits', () => {
		expect(lane_implement_split_stats.text([], DAYS, 2)).toBe(
			'Implement split, lanes merged in the last 14 days: 0 of 2 split (the rest have no dispatch or split rows in the ledger)',
		)
	})
})

describe('lane_implement_split_stats.report', () => {
	it('reads the lanes merged in the window and drops those without a split', () => {
		const breakdown: Breakdown = {
			stages: [],
			excluded_ms: 0,
			slept_ms: 0,
			yield_ms: 0,
			waits: [],
			implement: [],
			pre_detach: [],
			ship: [],
		}

		mocks.merged_in.mockReturnValue([1, 2, 3, 4])
		mocks.has_rows.mockImplementation((issue) => issue !== 4)
		mocks.breakdown_of.mockImplementation((_entries, _events, issue) =>
			issue === 1 ? undefined : breakdown,
		)
		mocks.of.mockImplementation((issue) => (issue === 2 ? split(8, 2) : undefined))

		const output = lane_implement_split_stats.report([], [], DAYS, NOW_MS)

		expect(mocks.merged_in).toHaveBeenCalledWith([], {
			from_ms: NOW_MS - DAYS * DAY_MS,
			to_ms: NOW_MS,
		})
		expect(output).toContain('1 of 4 split')
		expect(mocks.breakdown_of).not.toHaveBeenCalledWith([], [], 4)
		expect(output).toContain('- editing (tests included): median 8.0 min, in 1 of 1 runs')
	})
})
