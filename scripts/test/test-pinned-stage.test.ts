import { describe, expect, it, vi } from 'vitest'
import { test_pinned_stage, type StagePlan } from './test-pinned-stage'
import type { RedProbe } from './test-red-logic'

// joshuafolkken/kit#5292: a wide file's hunk is probed against its direct importers first, and the
// whole reach only when they do not go red; a narrow file runs its reach once.

const { WIDE_RATIO, WIDE_REACH } = test_pinned_stage
const FILE = 'scripts/gh/git-gh-pr-read.ts'
const DIRECT = ['scripts/gh/git-gh-pr-read.test.ts']
const RED: RedProbe = { verdict: 'red', failed: [DIRECT[0] ?? ''], ran: 1 }
const GREEN: RedProbe = { verdict: 'green', failed: [], ran: 1 }
const WIDE_PLAN: StagePlan = { direct: DIRECT, reach: [FILE] }
const NARROW_PLAN: StagePlan = { reach: [FILE] }

describe('test_pinned_stage.plan_over', () => {
	it('runs the direct importers first where the reach is at least the wide count', () => {
		expect(test_pinned_stage.plan_over(FILE, DIRECT, WIDE_REACH)).toEqual(WIDE_PLAN)
	})

	it('runs the direct importers first where the reach is the wide ratio of them', () => {
		expect(test_pinned_stage.plan_over(FILE, DIRECT, WIDE_RATIO * DIRECT.length)).toEqual(WIDE_PLAN)
	})

	it('runs the reach once where it is narrow', () => {
		const narrow = WIDE_RATIO * DIRECT.length - 1

		expect(test_pinned_stage.plan_over(FILE, DIRECT, narrow)).toEqual({ reach: [FILE] })
	})

	it('runs the reach once where no test imports the file directly', () => {
		expect(test_pinned_stage.plan_over(FILE, [], WIDE_REACH)).toEqual({ reach: [FILE] })
	})
})

describe('test_pinned_stage.staged_verdict', () => {
	it('decides on the direct importers when they go red, never running the reach', async () => {
		const staged = test_pinned_stage.none()
		const run = vi.fn<(files: ReadonlyArray<string>) => Promise<RedProbe>>().mockResolvedValue(RED)

		await expect(test_pinned_stage.staged_verdict(WIDE_PLAN, run, staged)).resolves.toEqual(RED)
		expect(run.mock.calls).toEqual([[DIRECT]])
		expect(staged).toEqual({ direct: 1, escalated: 0 })
	})

	it('answers by the whole reach when the direct importers do not go red', async () => {
		const staged = test_pinned_stage.none()
		const run = vi
			.fn<(files: ReadonlyArray<string>) => Promise<RedProbe>>()
			.mockResolvedValueOnce(GREEN)
			.mockResolvedValueOnce(RED)

		await expect(test_pinned_stage.staged_verdict(WIDE_PLAN, run, staged)).resolves.toEqual(RED)
		expect(run.mock.calls).toEqual([[DIRECT], [[FILE]]])
		expect(staged).toEqual({ direct: 0, escalated: 1 })
	})

	it('runs a narrow plan once and tallies nothing', async () => {
		const staged = test_pinned_stage.none()
		const run = vi
			.fn<(files: ReadonlyArray<string>) => Promise<RedProbe>>()
			.mockResolvedValue(GREEN)

		await expect(test_pinned_stage.staged_verdict(NARROW_PLAN, run, staged)).resolves.toEqual(GREEN)
		expect(run.mock.calls).toEqual([[[FILE]]])
		expect(staged).toEqual(test_pinned_stage.none())
	})
})

describe('test_pinned_stage.counts_suffix', () => {
	it('prints the decided and escalated counts', () => {
		expect(test_pinned_stage.counts_suffix({ direct: 2, escalated: 1 })).toBe(
			' · direct 2 · escalated 1',
		)
	})

	it('prints nothing when no probe ran in stages', () => {
		expect(test_pinned_stage.counts_suffix(test_pinned_stage.none())).toBe('')
		expect(test_pinned_stage.counts_suffix(undefined)).toBe('')
	})
})
