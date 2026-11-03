import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { check_related_unplanned } from '#scripts/gate/check-related-unplanned'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_plan_probe } from '#scripts/lane/lane-plan-probe'
import { run_ship_planned } from '#scripts/run/ship/run-ship-planned'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_unplanned } from './run-review-unplanned'

// joshuafolkken/kit#6142: joshuafolkken/kit#6035 met `CLAUDE.md`'s holder only at the ship's `unplanned`
// preflight and could only wait on it. `run:review`'s open asks `lane:plan` first.

const ROOT = mkdtempSync(path.join(tmpdir(), 'run-review-unplanned-'))
const directory = path.join(ROOT, 'lane')
const HOLDER = 6036
const LANE = 6035
const PLANNED = 'scripts/lane/planned.ts'
const HELD = 'scripts/lane/held.ts'
const FREE_FILE = 'scripts/lane/free.ts'
const LISTING_LIMIT = 100
const TEXT = 'unplanned: the two ways out'

const fetch_opted_in = vi.spyOn(auto_ok_cli, 'fetch_opted_in')
const read_unplanned = vi.spyOn(check_related_unplanned, 'read_unplanned')
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
	vi.clearAllMocks()
	info.mockImplementation(vi.fn())
	fetch_opted_in.mockResolvedValue(listing())
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		mkdtempSync(path.join(ROOT, 'repository-')),
	)
	lane_plan.record(
		{ issue: HOLDER, paths: [HELD], planned_at: '2026-11-01T00:00:00.000Z' },
		directory,
	)
	lane_plan.record(
		{ issue: LANE, paths: [PLANNED], planned_at: '2026-11-02T00:00:00.000Z', cleared: true },
		directory,
	)
})

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true })
})

describe('run_review_unplanned.refusal', () => {
	it('widens the plan on a clear check, so the ship finds nothing unplanned', async () => {
		found(FREE_FILE)

		expect(await run_review_unplanned.refusal(directory)).toBeUndefined()

		const claims = lane_plan.read(LANE, directory)?.paths ?? []

		expect(claims).toEqual([PLANNED, FREE_FILE])
		expect(run_ship_planned.unplanned_of(claims, [PLANNED, FREE_FILE])).toEqual([])
		expect(String(info.mock.calls[0]?.[0])).toContain(FREE_FILE)
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
