import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_plan } from './lane-plan'
import { lane_plan_check } from './lane-plan-check'
import { lane_plan_cli } from './lane-plan-cli'
import { lane_yield } from './lane-yield'

// joshuafolkken/kit#5211: joshuafolkken/kit#5171 investigated for six minutes before `lane:plan` found
// joshuafolkken/kit#5162 holding its file and gave the lane back. The probe answers the same overlap and
// writes nothing; the entry probe gives the lane back before any reading, on the paths dispatch gated on.

const ROOT = mkdtempSync(path.join(tmpdir(), 'lane-plan-check-'))
const HOLDER = 5162
const LATER = 5171
const HELD = 'scripts/test/vitest-failure-summary.ts'
const FREE_FILE = 'scripts/followup/followup-job-rerun.ts'
const SUCCESS = 0
const FAILURE = 1
const LISTING_LIMIT = 100
const PROBE = '--probe'

const fetch_opted_in = vi.spyOn(auto_ok_cli, 'fetch_opted_in')
const record_yield = vi.spyOn(lane_yield, 'record_yield')
const release = vi.spyOn(run_hold_cli, 'run')
const error = vi.spyOn(console, 'error')
const info = vi.spyOn(console, 'info')

// The plans live under the repository the spy below hands each test afresh.
const directory = path.join(ROOT, 'lane')

function running(number: number, body: string): OpenIssueData {
	const labels = [{ name: 'in-progress' }, { name: 'auto-ok' }]

	return { number, title: 'running', createdAt: '2026-10-27T11:00:00Z', labels, body }
}

function listing(
	issues: Array<OpenIssueData>,
): Awaited<ReturnType<typeof auto_ok_cli.fetch_opted_in>> {
	return { kind: 'read', issues, cutoff: cutoff_of(issues.length, LISTING_LIMIT, false) }
}

// The holder planned the file after the later issue was dispatched; its body names neither file.
function holding(later_body: string): Awaited<ReturnType<typeof auto_ok_cli.fetch_opted_in>> {
	return listing([running(HOLDER, ''), running(LATER, later_body)])
}

beforeEach(() => {
	vi.clearAllMocks()
	error.mockImplementation(vi.fn())
	info.mockImplementation(vi.fn())
	record_yield.mockResolvedValue(undefined)
	release.mockResolvedValue(SUCCESS)
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		mkdtempSync(path.join(ROOT, 'repository-')),
	)
	lane_plan.record(
		{ issue: HOLDER, paths: [HELD], planned_at: '2000-01-01T00:00:00.000Z' },
		directory,
	)
})

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true })
})

describe('lane:plan --probe', () => {
	it('answers `yield` on an overlap, recording no plan, no yield and no release', async () => {
		fetch_opted_in.mockResolvedValue(holding(''))

		const code = await lane_plan_cli.run([String(LATER), HELD, PROBE], directory)

		expect(code).toBe(lane_plan_cli.YIELD_EXIT_CODE)
		expect(info).toHaveBeenCalledWith('yield')
		expect(String(error.mock.calls[0]?.[0])).toContain(`#${String(HOLDER)}`)
		expect(lane_plan.read(LATER, directory)).toBeUndefined()
		expect(record_yield).not.toHaveBeenCalled()
		expect(release).not.toHaveBeenCalled()
	})

	it('answers `clear` on no overlap, recording no plan', async () => {
		fetch_opted_in.mockResolvedValue(holding(''))

		expect(await lane_plan_cli.run([String(LATER), FREE_FILE, PROBE], directory)).toBe(SUCCESS)
		expect(info).toHaveBeenCalledWith('clear')
		expect(lane_plan.read(LATER, directory)).toBeUndefined()
	})

	it('answers `wait` on a listing it could not read', async () => {
		fetch_opted_in.mockResolvedValue({ kind: 'unreadable' })

		expect(await lane_plan_cli.run([String(LATER), HELD, PROBE], directory)).toBe(FAILURE)
		expect(info).toHaveBeenCalledWith('wait')
	})
})

describe('lane_plan_check.yield_at_entry', () => {
	it('gives the lane back, noted at the entry, when its body cites a file a holder planned', async () => {
		fetch_opted_in.mockResolvedValue(holding(`Fix \`${HELD}:12\`.`))

		expect(await lane_plan_check.yield_at_entry(LATER, directory)).toBe(true)
		expect(record_yield).toHaveBeenCalledWith(LATER, expect.stringContaining(HELD), 'entry')
		expect(release).toHaveBeenCalledWith(['--release', String(LATER)])
		expect(lane_plan.read(LATER, directory)).toMatchObject({ paths: [HELD], yielded: true })
	})

	it.each([
		['a body citing no held file', holding(`Fix \`${FREE_FILE}\`.`)],
		['a body citing no path', holding('No path here.')],
		['an unreadable listing', { kind: 'unreadable' } as const],
	])('runs on and writes nothing for %s', async (_case, read) => {
		fetch_opted_in.mockResolvedValue(read)

		expect(await lane_plan_check.yield_at_entry(LATER, directory)).toBe(false)
		expect(lane_plan.read(LATER, directory)).toBeUndefined()
		expect(record_yield).not.toHaveBeenCalled()
		expect(release).not.toHaveBeenCalled()
	})
})
