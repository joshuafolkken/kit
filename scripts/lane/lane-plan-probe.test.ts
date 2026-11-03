import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_plan } from './lane-plan'
import { lane_plan_probe } from './lane-plan-probe'

// joshuafolkken/kit#6142: `run:review`'s open widens a plan through `extend`, which neither waits nor
// yields — a clear check records the widened plan, a clash or an unread listing writes nothing.

const ROOT = mkdtempSync(path.join(tmpdir(), 'lane-plan-probe-'))
const directory = path.join(ROOT, 'lane')
const HOLDER = 6036
const LANE = 6035
const PLANNED = 'scripts/lane/planned.ts'
const HELD = 'scripts/lane/held.ts'
const FREE_FILE = 'scripts/lane/free.ts'
const LISTING_LIMIT = 100
const LANE_PLAN = { issue: LANE, paths: [PLANNED], planned_at: '2026-11-02T00:00:00.000Z' }

const fetch_opted_in = vi.spyOn(auto_ok_cli, 'fetch_opted_in')

function running(number: number): OpenIssueData {
	const labels = [{ name: 'in-progress' }, { name: 'auto-ok' }]

	return { number, title: 'running', createdAt: '2026-11-01T00:00:00Z', labels, body: '' }
}

function listing(): Awaited<ReturnType<typeof auto_ok_cli.fetch_opted_in>> {
	const issues = [running(HOLDER), running(LANE)]

	return { kind: 'read', issues, cutoff: cutoff_of(issues.length, LISTING_LIMIT, false) }
}

beforeEach(() => {
	vi.clearAllMocks()
	fetch_opted_in.mockResolvedValue(listing())
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		mkdtempSync(path.join(ROOT, 'repository-')),
	)
	lane_plan.record(
		{ issue: HOLDER, paths: [HELD], planned_at: '2026-11-01T00:00:00.000Z' },
		directory,
	)
	lane_plan.record(LANE_PLAN, directory)
})

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true })
})

describe('lane_plan_probe.extend', () => {
	it('records the widened plan cleared when no running lane holds its files', async () => {
		const widened = { ...LANE_PLAN, paths: [PLANNED, FREE_FILE] }

		expect(await lane_plan_probe.extend(widened, directory)).toBeUndefined()
		expect(lane_plan.read(LANE, directory)).toMatchObject({
			paths: [PLANNED, FREE_FILE],
			cleared: true,
		})
	})

	it('returns the clash and records nothing when a running lane holds a file', async () => {
		const found = await lane_plan_probe.extend({ ...LANE_PLAN, paths: [PLANNED, HELD] }, directory)

		expect(found).toMatchObject({ holder: HOLDER, path: HELD })
		expect(lane_plan.read(LANE, directory)?.paths).toEqual([PLANNED])
	})

	it('answers unread and records nothing when the listing cannot be read', async () => {
		fetch_opted_in.mockResolvedValue({ kind: 'unreadable' })

		const found = await lane_plan_probe.extend(
			{ ...LANE_PLAN, paths: [PLANNED, FREE_FILE] },
			directory,
		)

		expect(lane_plan_probe.is_unread(found)).toBe(true)
		expect(lane_plan.read(LANE, directory)?.paths).toEqual([PLANNED])
	})
})
