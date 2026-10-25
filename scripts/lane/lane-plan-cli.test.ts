import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_plan } from './lane-plan'
import { lane_plan_cli } from './lane-plan-cli'

// joshuafolkken/kit#4864: joshuafolkken/kit#4858 and joshuafolkken/kit#4859 declared disjoint paths
// and both edited `scripts/lane/lane-overrun.ts`. The later plan now waits before implementing and
// names the file and the holder; a plan that overlaps nothing runs on at once.

const ROOT = mkdtempSync(path.join(tmpdir(), 'lane-plan-cli-'))
const DIRECTORY = path.join(ROOT, 'lane')
const HOLDER = 4858
const LATER = 4859
const OVERRUN = 'scripts/lane/lane-overrun.ts'
const PRIORITY = 'scripts/issue/issue-priority.ts'
const SUCCESS = 0
const FAILURE = 1
const LISTING_LIMIT = 100
const ONCE = { attempts: 1, interval_ms: 0 }
const TWICE = { attempts: 2, interval_ms: 0, sleeper: vi.fn().mockResolvedValue(undefined) }

const fetch_opted_in = vi.spyOn(auto_ok_cli, 'fetch_opted_in')
const error = vi.spyOn(console, 'error')
const info = vi.spyOn(console, 'info')

function running(number: number, body: string): OpenIssueData {
	const labels = [{ name: 'in-progress' }, { name: 'auto-ok' }]

	return {
		number,
		title: 'running',
		createdAt: '2026-10-25T03:07:44Z',
		blockedBy: undefined,
		labels,
		body,
	}
}

function listing(
	issues: Array<OpenIssueData>,
): Awaited<ReturnType<typeof auto_ok_cli.fetch_opted_in>> {
	return { kind: 'read', issues, cutoff: cutoff_of(issues.length, LISTING_LIMIT, false) }
}

// The holder is running with a plan recorded before this lane's; its body names another file, so the
// bodies alone overlap nothing.
const HOLDING = listing([running(HOLDER, '`scripts/lane/lane-phase.ts:82-94`'), running(LATER, '')])
const HOLDER_LEFT = listing([running(LATER, '')])

beforeEach(() => {
	vi.clearAllMocks()
	error.mockImplementation(vi.fn())
	info.mockImplementation(vi.fn())
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		mkdtempSync(path.join(ROOT, 'repository-')),
	)
	lane_plan.record(
		{ issue: HOLDER, paths: [OVERRUN, PRIORITY], planned_at: '2000-01-01T00:00:00.000Z' },
		DIRECTORY,
	)
})

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true })
})

describe('lane:plan — a plan that edits a file an earlier plan holds', () => {
	it('waits before implementing and names the file and the holder', async () => {
		fetch_opted_in.mockResolvedValue(HOLDING)

		expect(await lane_plan_cli.run([String(LATER), OVERRUN], ONCE, DIRECTORY)).toBe(FAILURE)
		expect(info).toHaveBeenCalledWith('wait')
		expect(String(error.mock.calls[0]?.[0])).toMatch(
			new RegExp(`waits before implementing: its planned \`${OVERRUN}\`.*#${String(HOLDER)}`, 'u'),
		)
	})

	it('runs on once the holder’s lane ends, saying why it waited only once', async () => {
		fetch_opted_in.mockResolvedValueOnce(HOLDING).mockResolvedValueOnce(HOLDER_LEFT)

		expect(await lane_plan_cli.run([String(LATER), OVERRUN], TWICE, DIRECTORY)).toBe(SUCCESS)
		expect(info).toHaveBeenCalledWith('clear')
		expect(error).toHaveBeenCalledOnce()
	})

	it('records its own plan, so a later candidate is weighed against it', async () => {
		fetch_opted_in.mockResolvedValue(HOLDER_LEFT)

		await lane_plan_cli.run([String(LATER), `${PRIORITY}:203`], ONCE, DIRECTORY)

		expect(lane_plan.read(LATER, DIRECTORY)?.paths).toEqual([PRIORITY])
	})
})

describe('lane:plan — a plan that overlaps nothing', () => {
	it('runs on at once, side by side with the holder', async () => {
		fetch_opted_in.mockResolvedValue(HOLDING)

		const code = await lane_plan_cli.run(
			[String(LATER), 'scripts/lane/lane-plan.ts'],
			TWICE,
			DIRECTORY,
		)

		expect(code).toBe(SUCCESS)
		expect(fetch_opted_in).toHaveBeenCalledOnce()
		expect(error).not.toHaveBeenCalled()
	})
})

describe('lane:plan — what it refuses', () => {
	it.each([
		['no path', []],
		['no path it can hold', ['joshuafolkken/kit#4858']],
	])('prints the usage for a call with %s', async (_case, paths) => {
		expect(await lane_plan_cli.run([String(LATER), ...paths], ONCE, DIRECTORY)).toBe(FAILURE)
		expect(error).toHaveBeenCalledWith(lane_plan_cli.USAGE)
	})

	it('waits rather than starting on a listing it could not read', async () => {
		fetch_opted_in.mockResolvedValue({ kind: 'unreadable' })

		expect(await lane_plan_cli.run([String(LATER), OVERRUN], ONCE, DIRECTORY)).toBe(FAILURE)
		expect(error).toHaveBeenCalledWith(auto_ok_cli.UNREADABLE_MESSAGE)
	})
})
