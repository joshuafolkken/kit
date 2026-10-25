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
import { lane_yield } from './lane-yield'

// joshuafolkken/kit#4864: joshuafolkken/kit#4858 and joshuafolkken/kit#4859 declared disjoint paths
// and both edited `scripts/lane/lane-overrun.ts`. The later plan is held back before implementing and
// names the file and the holder; a plan that overlaps nothing runs on at once.
//
// joshuafolkken/kit#4926: the held-back lane polled up to nine minutes a call, two to four calls, with its
// seat taken. It now gives its lane back on the first answer, and a docs-only overlap holds nothing.

const ROOT = mkdtempSync(path.join(tmpdir(), 'lane-plan-cli-'))
const DIRECTORY = path.join(ROOT, 'lane')
const HOLDER = 4858
const LATER = 4859
const OVERRUN = 'scripts/lane/lane-overrun.ts'
const PRIORITY = 'scripts/issue/issue-priority.ts'
const RUN_DOC = 'docs/josh-commands-run.md'
const FREE_FILE = 'scripts/lane/lane-plan.ts'
const SUCCESS = 0
const FAILURE = 1
const LISTING_LIMIT = 100

const fetch_opted_in = vi.spyOn(auto_ok_cli, 'fetch_opted_in')
const record_yield = vi.spyOn(lane_yield, 'record_yield')
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
	record_yield.mockResolvedValue(undefined)
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		mkdtempSync(path.join(ROOT, 'repository-')),
	)
	lane_plan.record(
		{ issue: HOLDER, paths: [OVERRUN, PRIORITY, RUN_DOC], planned_at: '2000-01-01T00:00:00.000Z' },
		DIRECTORY,
	)
})

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true })
})

describe('lane:plan — a plan that edits a file an earlier plan holds', () => {
	it('gives its lane back on the first answer, naming the file and the holder', async () => {
		fetch_opted_in.mockResolvedValue(HOLDING)

		const code = await lane_plan_cli.run([String(LATER), OVERRUN], DIRECTORY)

		expect(code).toBe(lane_plan_cli.YIELD_EXIT_CODE)
		expect(fetch_opted_in).toHaveBeenCalledOnce()
		expect(info).toHaveBeenCalledWith('yield')
		expect(String(error.mock.calls[0]?.[0])).toMatch(
			new RegExp(`planned \`${OVERRUN}\`.*#${String(HOLDER)}.*gives its lane back`, 'u'),
		)
	})

	it('puts the yield on the stream and keeps its plan uncleared', async () => {
		fetch_opted_in.mockResolvedValue(HOLDING)

		await lane_plan_cli.run([String(LATER), OVERRUN], DIRECTORY)

		expect(record_yield).toHaveBeenCalledWith(LATER, expect.stringContaining(OVERRUN))
		expect(lane_plan.read(LATER, DIRECTORY)?.paths).toEqual([OVERRUN])
		expect(lane_plan.is_uncleared(LATER, DIRECTORY)).toBe(true)
	})

	it('runs on once the holder’s lane has ended', async () => {
		fetch_opted_in.mockResolvedValue(HOLDER_LEFT)

		expect(await lane_plan_cli.run([String(LATER), OVERRUN], DIRECTORY)).toBe(SUCCESS)
		expect(info).toHaveBeenCalledWith('clear')
		expect(lane_plan.is_uncleared(LATER, DIRECTORY)).toBe(false)
		expect(record_yield).not.toHaveBeenCalled()
	})
})

describe('lane:plan — the plan it records', () => {
	it('records its own plan, so a later candidate is weighed against it', async () => {
		fetch_opted_in.mockResolvedValue(HOLDER_LEFT)

		await lane_plan_cli.run([String(LATER), `${PRIORITY}:203`], DIRECTORY)

		expect(lane_plan.read(LATER, DIRECTORY)?.paths).toEqual([PRIORITY])
	})

	it('keeps the place in line of a plan it records again, so it goes on holding its files', async () => {
		const first = '1999-01-01T00:00:00.000Z'

		lane_plan.record({ issue: LATER, paths: [PRIORITY], planned_at: first }, DIRECTORY)
		fetch_opted_in.mockResolvedValue(HOLDING)

		expect(await lane_plan_cli.run([String(LATER), OVERRUN], DIRECTORY)).toBe(SUCCESS)
		expect(lane_plan.read(LATER, DIRECTORY)).toMatchObject({ paths: [OVERRUN], planned_at: first })
	})
})

describe('lane:plan — a plan that overlaps nothing', () => {
	it('runs on at once, side by side with the holder', async () => {
		fetch_opted_in.mockResolvedValue(HOLDING)

		const code = await lane_plan_cli.run([String(LATER), FREE_FILE], DIRECTORY)

		expect(code).toBe(SUCCESS)
		expect(error).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#4926: joshuafolkken/kit#4916 waited 27 minutes on joshuafolkken/kit#4910 for
	// this file alone.
	it('runs on at once when only a document under docs/ overlaps the holder’s plan', async () => {
		fetch_opted_in.mockResolvedValue(HOLDING)

		const code = await lane_plan_cli.run([String(LATER), RUN_DOC, FREE_FILE], DIRECTORY)

		expect(code).toBe(SUCCESS)
		expect(info).toHaveBeenCalledWith('clear')
		expect(record_yield).not.toHaveBeenCalled()
	})
})

describe('lane:plan — what it refuses', () => {
	it.each([
		['no path', []],
		['no path it can hold', ['joshuafolkken/kit#4858']],
	])('prints the usage for a call with %s', async (_case, paths) => {
		expect(await lane_plan_cli.run([String(LATER), ...paths], DIRECTORY)).toBe(FAILURE)
		expect(error).toHaveBeenCalledWith(lane_plan_cli.USAGE)
	})

	it('waits rather than starting on a listing it could not read', async () => {
		fetch_opted_in.mockResolvedValue({ kind: 'unreadable' })

		expect(await lane_plan_cli.run([String(LATER), OVERRUN], DIRECTORY)).toBe(FAILURE)
		expect(info).toHaveBeenCalledWith('wait')
		expect(error).toHaveBeenCalledWith(auto_ok_cli.UNREADABLE_MESSAGE)
		expect(record_yield).not.toHaveBeenCalled()
	})
})
