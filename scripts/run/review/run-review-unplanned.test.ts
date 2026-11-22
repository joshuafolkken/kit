import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { backlog_overlap, type Clash } from '#scripts/backlog/backlog-overlap'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { check_related_unplanned } from '#scripts/gate/check-related-unplanned'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_plan_probe } from '#scripts/lane/lane-plan-probe'
import { lane_plan_wait } from '#scripts/lane/lane-plan-wait'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_ship_planned } from '#scripts/run/ship/run-ship-planned'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_unplanned } from './run-review-unplanned'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#6142: joshuafolkken/kit#6035 met `CLAUDE.md`'s holder only at the ship's `unplanned`
// preflight and could only wait on it. `run:review`'s open asks `lane:plan` first.

const ROOT = make_directory('run-review-unplanned-')
const directory = path.join(ROOT, 'lane')
const HOLDER = 6036
const LANE = 6035
const PLANNED = 'scripts/lane/planned.ts'
const HELD = 'scripts/lane/held.ts'
const FREE_FILE = 'scripts/lane/free.ts'
const LISTING_LIMIT = 100
const TEXT = 'unplanned: the two ways out'
const REMAINING_MINUTES = 12
const LANE_PLANNED_AT = '2026-11-02T00:00:00.000Z'
const PASSED_WAIT = '2026-11-02T00:30:00.000Z'
const YIELDS = 'would yield'
const REPO = 'joshuafolkken/kit'

const fetch_opted_in = vi.spyOn(auto_ok_cli, 'fetch_opted_in')
const read_unplanned = vi.spyOn(check_related_unplanned, 'read_unplanned')
const read_changed = vi.spyOn(changed_paths, 'read_changed_paths')
const info = vi.spyOn(console, 'info')

function running(number: number): OpenIssueData {
	const labels = [{ name: 'in-progress' }, { name: 'auto-ok' }]

	return { number, title: 'running', createdAt: '2026-11-01T00:00:00Z', labels, body: '' }
}

function listing(): Awaited<ReturnType<typeof auto_ok_cli.fetch_opted_in>> {
	const issues = [running(HOLDER), running(LANE)]

	return { kind: 'read', issues, cutoff: cutoff_of(issues.length, LISTING_LIMIT, false) }
}

function found(file: string): void {
	read_unplanned.mockResolvedValue({ issue: LANE, files: [file], text: TEXT })
}

beforeEach(() => {
	info.mockImplementation(vi.fn())
	read_changed.mockResolvedValue([])
	fetch_opted_in.mockResolvedValue(listing())
	vi.spyOn(lane_plan_wait, 'deadline').mockResolvedValue(undefined)
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		make_directory(path.join(ROOT, 'repository-')),
	)
	lane_plan.record(
		{ issue: HOLDER, paths: [HELD], planned_at: '2026-11-01T00:00:00.000Z' },
		directory,
	)
	lane_plan.record(
		{ issue: LANE, paths: [PLANNED], planned_at: LANE_PLANNED_AT, cleared: true },
		directory,
	)
})

describe('run_review_unplanned.refusal', () => {
	it('widens the plan on a clear check, so the ship finds nothing unplanned', async () => {
		found(FREE_FILE)

		expect(await run_review_unplanned.refusal(directory)).toBeUndefined()

		const claims = lane_plan.read(LANE, directory)?.paths ?? []

		expect(claims).toEqual([PLANNED, FREE_FILE])
		expect(run_ship_planned.unplanned_of(claims, [PLANNED, FREE_FILE])).toEqual([])
		expect(String(info.mock.calls[0]?.[0])).toContain(FREE_FILE)
		expect(lane_plan.read(LANE, directory)?.widened_paths).toEqual([FREE_FILE])
	})

	it('stops on a holder before the review, naming it and the ways out, recording nothing', async () => {
		found(HELD)

		const stop = await run_review_unplanned.refusal(directory)

		expect(stop).toContain(`#${String(HOLDER)}`)
		expect(stop).toContain(TEXT)
		expect(lane_plan.read(LANE, directory)?.paths).toEqual([PLANNED])
	})

	it('neither stops nor records on an unread listing, leaving the ship its check', async () => {
		found(FREE_FILE)
		fetch_opted_in.mockResolvedValue({ kind: 'unreadable' })

		expect(await run_review_unplanned.refusal(directory)).toBeUndefined()
		expect(lane_plan.read(LANE, directory)?.paths).toEqual([PLANNED])
	})

	it('asks nothing when no file is unplanned', async () => {
		read_unplanned.mockResolvedValue(undefined)

		expect(await run_review_unplanned.refusal(directory)).toBeUndefined()
		expect(fetch_opted_in).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#7640: the edit hook's stdout carries one JSON envelope, so it takes the line.
describe('run_review_unplanned.refusal_to', () => {
	it('hands the widening line to the given inform instead of the console', async () => {
		found(FREE_FILE)
		const inform = vi.fn()

		expect(await run_review_unplanned.refusal_to(directory, inform)).toBeUndefined()
		expect(String(inform.mock.calls[0]?.[0])).toContain(FREE_FILE)
		expect(info).not.toHaveBeenCalled()
	})
})

describe('run_review_unplanned.refusal — the wait on the holder (joshuafolkken/kit#6145)', () => {
	it('names the holder, the minutes left, the issue:spill way out and the lane:plan wait', async () => {
		found(HELD)
		vi.spyOn(lane_plan_wait, 'deadline').mockImplementationOnce(
			async (_issue: number, _holder: number, now_ms: number): Promise<number> =>
				now_ms + REMAINING_MINUTES * MS_PER_MINUTE,
		)

		const stop = await run_review_unplanned.refusal(directory)

		expect(stop).toContain(`/issues/${String(HOLDER)}) at most ${String(REMAINING_MINUTES)} min`)
		expect(stop).toContain(`pnpm josh issue:spill ${String(LANE)} --estimate`)
		expect(stop).toContain(`pnpm josh lane:plan ${String(LANE)} ${PLANNED} ${HELD}\` to wait`)
		expect(stop).toContain(TEXT)
	})

	it('offers only the spill when lane:plan would yield to the holder', async () => {
		found(HELD)

		const stop = await run_review_unplanned.refusal(directory)

		expect(stop).toContain(YIELDS)
		expect(stop).toContain('issue:spill')
		expect(stop).not.toContain('to wait')
	})
})

describe('run_review_unplanned.refusal — a wait the plan already recorded', () => {
	it('reads that deadline, as lane:plan does, and yields once it passed', async () => {
		found(HELD)
		lane_plan.record(
			{ issue: LANE, paths: [PLANNED], planned_at: LANE_PLANNED_AT, waits_until: PASSED_WAIT },
			directory,
		)

		const stop = await run_review_unplanned.refusal(directory)

		expect(stop).toContain(YIELDS)
		expect(lane_plan_wait.deadline).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#8662: joshuafolkken/kit#8570's record kept `scripts/run/board/`, named only in its
// plan comment's prose, after its changes moved to `scripts/test/`, and held joshuafolkken/kit#8658's
// new file under it.
const BOARD = 'scripts/run/board/'
const NEW_FILE = 'scripts/run/board/run-board-notice-trace.ts'
const WAITING = 8658

function record_board(changed: ReadonlyArray<string>): void {
	lane_plan.record(
		{ issue: LANE, paths: [PLANNED, BOARD], planned_at: LANE_PLANNED_AT, cleared: true },
		directory,
	)
	read_changed.mockResolvedValue([...changed])
	found(FREE_FILE)
}

function clash_on(paths: ReadonlyArray<string>): Clash | undefined {
	const bodies = new Map([[WAITING, new Set(paths)]])
	const declared = lane_plan.with_plans(new Map([...bodies, [LANE, new Set()]]), directory)
	const child: EpicChild = {
		number: WAITING,
		repo: REPO,
		state: 'OPEN',
		labels: [],
		blocked_by: [],
	}

	return backlog_overlap.running_clash(child, declared, { holders: [LANE], repo: REPO })
}

describe('run_review_unplanned.refusal — narrowing the record to the actual changes', () => {
	it('drops a directory claim no change sits in, so a new file there no longer waits', async () => {
		record_board([PLANNED, FREE_FILE])

		expect(await run_review_unplanned.refusal(directory)).toBeUndefined()
		expect(lane_plan.read(LANE, directory)?.paths).toEqual([PLANNED, FREE_FILE])
		expect(clash_on([NEW_FILE])).toBeUndefined()
		expect(clash_on([FREE_FILE])?.holder).toBe(LANE)
	})

	it('keeps a directory claim a change sits in, and a new file there still waits', async () => {
		record_board([PLANNED, `${BOARD}run-board.ts`, FREE_FILE])

		expect(await run_review_unplanned.refusal(directory)).toBeUndefined()
		expect(lane_plan.read(LANE, directory)?.paths).toEqual([PLANNED, BOARD, FREE_FILE])
		expect(clash_on([NEW_FILE])?.claimed).toBe(BOARD)
	})
})

describe('run_review_unplanned.refusal — a widening past the declared size', () => {
	it('stops, pointing at lane:plan, recording nothing', async () => {
		found(FREE_FILE)
		vi.spyOn(lane_plan_probe, 'extend').mockResolvedValueOnce('oversize')

		const stop = await run_review_unplanned.refusal(directory)

		expect(stop).toContain('lane:plan')
		expect(stop).toContain(TEXT)
		expect(lane_plan.read(LANE, directory)?.paths).toEqual([PLANNED])
	})
})
