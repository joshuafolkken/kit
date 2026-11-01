import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { line_budget } from '#scripts/lines/line-budget'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_plan } from './lane-plan'
import { lane_plan_check } from './lane-plan-check'
import { lane_plan_cli } from './lane-plan-cli'
import { lane_plan_signals } from './lane-plan-signals'
import { lane_yield } from './lane-yield'

// joshuafolkken/kit#5211: joshuafolkken/kit#5171 investigated for six minutes before `lane:plan` found
// joshuafolkken/kit#5162 holding its file and gave the lane back. The probe answers the same overlap and
// writes nothing; the entry probe gives the lane back before any reading, on the paths dispatch gated on.

const ROOT = mkdtempSync(path.join(tmpdir(), 'lane-plan-check-'))
const HOLDER = 5162
const LATER = 5171
const HELD = 'scripts/test/vitest-failure-summary.ts'
const FREE_FILE = 'scripts/followup/followup-job-rerun.ts'
const ONE_FILE = 'scripts/lane/one.ts'
const SUCCESS = 0
const FAILURE = 1
const LISTING_LIMIT = 100
const PROBE = '--probe'

const fetch_opted_in = vi.spyOn(auto_ok_cli, 'fetch_opted_in')
const record_yield = vi.spyOn(lane_yield, 'record_yield')
const release = vi.spyOn(run_hold_cli, 'run')
const error = vi.spyOn(console, 'error')
const info = vi.spyOn(console, 'info')
const budgets = vi.spyOn(line_budget, 'budgets_for')
const signals_of = vi.spyOn(lane_plan_signals, 'signals_of')
const record_split_notice = vi.spyOn(lane_ledger_write, 'record_split_notice')
const QUIET = { hunk_files: [], committed_files: [], lines_ratio: undefined, split_filed: false }
const PROBED = 'scripts/lane/probed.ts'
const DECLARED = '## 背景\n\n- 規模見積もり: 約 1 ファイル / 20 行（テスト除く）\n'

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
	budgets.mockResolvedValue([])
	signals_of.mockResolvedValue(QUIET)
	record_split_notice.mockResolvedValue(undefined)
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

describe('lane:plan line headroom', () => {
	it.each([20, 0, -1])(
		'warns with %s lines left without changing the clear verdict',
		async (headroom) => {
			fetch_opted_in.mockResolvedValue(holding(''))
			budgets.mockResolvedValue([
				{
					file_path: path.resolve(directory, FREE_FILE),
					limit: 300,
					budget: { code_lines: 300 - headroom, limit: 300, headroom, is_near_limit: true },
				},
			])

			expect(await lane_plan_cli.run([String(LATER), FREE_FILE], directory)).toBe(SUCCESS)
			expect(error).toHaveBeenCalledWith(`near cap: ${FREE_FILE} (${String(headroom)} lines left)`)
			expect(info).toHaveBeenCalledWith('clear')
			expect(budgets).toHaveBeenCalledWith([path.resolve(directory, FREE_FILE)], directory)
		},
	)

	it('does not warn with 21 lines left or an unavailable budget', async () => {
		fetch_opted_in.mockResolvedValue(holding(''))
		budgets.mockResolvedValue([
			{
				file_path: FREE_FILE,
				limit: 300,
				budget: { code_lines: 279, limit: 300, headroom: 21, is_near_limit: true },
			},
			{ file_path: 'new.ts', limit: undefined, budget: undefined },
		])

		expect(await lane_plan_cli.run([String(LATER), FREE_FILE, 'new.ts'], directory)).toBe(SUCCESS)
		expect(error).not.toHaveBeenCalled()
	})
})

it('does not run line counting for a probe', async () => {
	fetch_opted_in.mockResolvedValue(holding(''))
	await lane_plan_cli.run([String(LATER), FREE_FILE, PROBE], directory)

	expect(budgets).not.toHaveBeenCalled()
})

// joshuafolkken/kit#5533: a plan past twice its declared files answers `split` and is never recorded.
describe('lane:plan size bar', () => {
	const grown = [FREE_FILE, ONE_FILE, 'scripts/lane/two.ts']

	it.each([[[]], [[PROBE]]])(
		'answers `split` with no record for a plan over the bar (flags %j)',
		async (flags) => {
			fetch_opted_in.mockResolvedValue(holding(DECLARED))

			const code = await lane_plan_cli.run([String(LATER), ...grown, ...flags], directory)

			expect(code).toBe(lane_plan_check.SPLIT_EXIT_CODE)
			expect(info).toHaveBeenCalledWith('split')
			expect(String(error.mock.calls.at(-1)?.[0])).toContain('Split off: scripts/lane/two.ts')
			expect(lane_plan.read(LATER, directory)).toBeUndefined()
		},
	)

	it('records and clears a plan within the bar', async () => {
		fetch_opted_in.mockResolvedValue(holding(DECLARED))

		expect(await lane_plan_cli.run([String(LATER), ...grown.slice(0, 2)], directory)).toBe(SUCCESS)
		expect(info).toHaveBeenCalledWith('clear')
	})
})

// joshuafolkken/kit#5568: the hunks axis refuses too, and the refusal goes on the ledger with its reason.
describe('lane:plan size bar on the probed hunks', () => {
	it('notes a `split` on the probed hunks with its reason, and `--probe` notes nothing', async () => {
		fetch_opted_in.mockResolvedValue(holding(DECLARED))
		signals_of.mockResolvedValue({ ...QUIET, hunk_files: [PROBED, PROBED, PROBED] })
		const plan = [String(LATER), FREE_FILE]

		expect(await lane_plan_cli.run([...plan, PROBE], directory)).toBe(
			lane_plan_check.SPLIT_EXIT_CODE,
		)
		expect(record_split_notice).not.toHaveBeenCalled()
		expect(await lane_plan_cli.run(plan, directory)).toBe(lane_plan_check.SPLIT_EXIT_CODE)
		expect(record_split_notice).toHaveBeenCalledWith({
			issue: LATER,
			files: 1,
			lines: 0,
			reason: 'hunks',
		})
		expect(String(error.mock.calls.at(-1)?.[0])).toContain('split (hunks)')
	})
})

// joshuafolkken/kit#5605: a plan that met the size bar keeps it met across an unread or yielded re-plan,
// while a plan the entry probe yielded on never met it, so its first `lane:plan` judges the lines axis.
const LINED = '## 背景\n\n- 規模見積もり: 約 2 ファイル / 160 行（テスト除く）\n'

describe('lane:plan size bar across a re-plan of a cleared plan', () => {
	const added = [FREE_FILE, ONE_FILE]

	beforeEach(() => {
		signals_of.mockResolvedValue({ ...QUIET, lines_ratio: 1.8 })
		lane_plan.record(
			{ issue: LATER, paths: [FREE_FILE], planned_at: '2001-01-01T00:00:00.000Z', cleared: true },
			directory,
		)
	})

	it('does not answer `split (lines)` on the run after an unread re-plan of a cleared plan', async () => {
		fetch_opted_in.mockResolvedValueOnce({ kind: 'unreadable' })
		fetch_opted_in.mockResolvedValue(holding(LINED))

		expect(await lane_plan_cli.run([String(LATER), ...added], directory)).toBe(FAILURE)
		expect(await lane_plan_cli.run([String(LATER), ...added], directory)).toBe(SUCCESS)
		expect(info).not.toHaveBeenCalledWith('split')
	})

	it('records a yielded re-plan of a cleared plan as sized', async () => {
		fetch_opted_in.mockResolvedValue(holding(LINED))

		const code = await lane_plan_cli.run([String(LATER), FREE_FILE, HELD], directory)

		expect(code).toBe(lane_plan_cli.YIELD_EXIT_CODE)
		expect(lane_plan.read(LATER, directory)).toMatchObject({ sized: true, yielded: true })
	})
})

describe('lane:plan size bar with no recorded plan', () => {
	beforeEach(() => {
		signals_of.mockResolvedValue({ ...QUIET, lines_ratio: 1.8 })
	})

	it('keeps a plan that met the bar and yielded at the summary from `split (lines)` on its re-plan', async () => {
		signals_of.mockResolvedValueOnce({ ...QUIET, lines_ratio: 1 })
		fetch_opted_in.mockResolvedValue(holding(LINED))
		const plan = [String(LATER), FREE_FILE, HELD]

		expect(await lane_plan_cli.run(plan, directory)).toBe(lane_plan_cli.YIELD_EXIT_CODE)
		expect(lane_plan.read(LATER, directory)).toMatchObject({ sized: true, yielded: true })
		expect(await lane_plan_cli.run(plan, directory)).toBe(lane_plan_cli.YIELD_EXIT_CODE)
		expect(info).not.toHaveBeenCalledWith('split')
	})

	it('does not record `sized` for an Issue that declares no size', async () => {
		fetch_opted_in.mockResolvedValue(holding(''))

		await lane_plan_cli.run([String(LATER), FREE_FILE, HELD], directory)

		expect(lane_plan.read(LATER, directory)?.sized).toBeUndefined()
	})

	it('judges the lines axis on the first `lane:plan` after an entry-probe yield', async () => {
		fetch_opted_in.mockResolvedValue(holding(`${LINED}\nFix \`${HELD}:12\`.`))

		expect(await lane_plan_check.yield_at_entry(LATER, directory)).toBe(true)
		expect(await lane_plan_cli.run([String(LATER), FREE_FILE], directory)).toBe(
			lane_plan_check.SPLIT_EXIT_CODE,
		)
		expect(String(error.mock.calls.at(-1)?.[0])).toContain('split (lines)')
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
