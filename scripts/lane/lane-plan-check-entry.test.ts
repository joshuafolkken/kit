import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { line_budget } from '#scripts/lines/line-budget'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_child_marker } from './lane-child-marker'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_plan } from './lane-plan'
import { lane_plan_check } from './lane-plan-check'
import { lane_plan_cli } from './lane-plan-cli'
import { lane_plan_signals } from './lane-plan-signals'
import { lane_tree_edit } from './lane-tree-edit'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#7729: joshuafolkken/kit#7695 declared 6 files and its investigation listed 18, yet a
// dispatched lane was never split, so it ran to the end. Before its first edit, a dispatched lane's plan
// past the cap answers `split`; past its declaration but within the cap it is recorded with a warning;
// `--single` keeps it whole with a reason that goes on the ledger and the Issue. After the first edit,
// `lane-plan-check-dispatched.test.ts`.

const ROOT = make_directory('lane-plan-check-entry-')
const LANE = 7695
const SUCCESS = 0
const FAILURE = 1
const LISTING_LIMIT = 100
const PAST_CAP = 18
const WITHIN_CAP = 8
const DECLARED_FILES = 6
const DECLARED = '## 背景\n\n- 規模見積もり: 約 3 ファイル / 20 行（テスト含む）\n'
const REASON = 'one gate rule whose parts cannot merge alone'
const WARNING = 'size warning (files)'

const fetch_opted_in = vi.spyOn(auto_ok_cli, 'fetch_opted_in')
const error = vi.spyOn(console, 'error')
const info = vi.spyOn(console, 'info')
const signals_of = vi.spyOn(lane_plan_signals, 'signals_of')
const record_split_notice = vi.spyOn(lane_ledger_write, 'record_split_notice')
const issue_try_comment = vi.spyOn(git_gh_issue_write, 'issue_try_comment')
const is_edited = vi.spyOn(lane_tree_edit, 'is_edited')
const QUIET = lane_plan_signals.signals_from(LANE, { hunk_files: [], committed_files: [] }, [], 0)
const directory = path.join(ROOT, 'lane')

function plan_of(count: number): Array<string> {
	const files = Array.from(
		{ length: count },
		(_, index) => `scripts/lane/entry-${String(index)}.ts`,
	)

	return [String(LANE), ...files]
}

function listing(): Awaited<ReturnType<typeof auto_ok_cli.fetch_opted_in>> {
	const labels = [{ name: 'in-progress' }, { name: 'auto-ok' }]
	const issues: Array<OpenIssueData> = [
		{ number: LANE, title: 'running', createdAt: '2026-11-17T00:00:00Z', labels, body: DECLARED },
	]

	return { kind: 'read', issues, cutoff: cutoff_of(issues.length, LISTING_LIMIT, false) }
}

function stub_writes(): void {
	record_split_notice.mockResolvedValue(undefined)
	issue_try_comment.mockResolvedValue(true)
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		make_directory(path.join(ROOT, 'repository-')),
	)
}

beforeEach(() => {
	vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([])
	signals_of.mockResolvedValue(QUIET)
	error.mockImplementation(vi.fn())
	info.mockImplementation(vi.fn())
	fetch_opted_in.mockResolvedValue(listing())
	stub_writes()
	vi.stubEnv(lane_child_marker.KEY, String(LANE))
	is_edited.mockResolvedValue(false)
})

describe('lane:plan in a dispatched lane before its first edit', () => {
	it('answers `split` past the cap and records no plan', async () => {
		expect(await lane_plan_cli.run(plan_of(PAST_CAP), directory)).toBe(
			lane_plan_check.SPLIT_EXIT_CODE,
		)
		expect(info).toHaveBeenCalledWith('split')
		expect(lane_plan.read(LANE, directory)).toBeUndefined()
	})

	it("answers `split` to the investigation's re-plan after `run:entry` recorded a smaller one", async () => {
		expect(await lane_plan_cli.run(plan_of(DECLARED_FILES), directory)).toBe(SUCCESS)

		expect(await lane_plan_cli.run(plan_of(PAST_CAP), directory)).toBe(
			lane_plan_check.SPLIT_EXIT_CODE,
		)
		expect(lane_plan.read(LANE, directory)?.paths).toHaveLength(DECLARED_FILES)
	})

	it('records a plan past its declaration but within the cap, warning and noting it', async () => {
		expect(await lane_plan_cli.run(plan_of(WITHIN_CAP), directory)).toBe(SUCCESS)
		expect(error).toHaveBeenCalledWith(expect.stringContaining(WARNING))
		expect(record_split_notice).toHaveBeenCalledWith({
			issue: LANE,
			files: WITHIN_CAP,
			lines: 0,
			reason: 'files',
		})
	})

	it('answers `split` to `--probe` past the cap, recording nothing', async () => {
		expect(await lane_plan_cli.run([...plan_of(PAST_CAP), '--probe'], directory)).toBe(
			lane_plan_check.SPLIT_EXIT_CODE,
		)
		expect(record_split_notice).not.toHaveBeenCalled()
	})
})

describe('lane:plan --single before the first edit', () => {
	it('records the plan past the cap and puts the reason on the ledger and the Issue', async () => {
		expect(await lane_plan_cli.run([...plan_of(PAST_CAP), '--single', REASON], directory)).toBe(
			SUCCESS,
		)
		expect(lane_plan.read(LANE, directory)).toMatchObject({ single: true, single_reason: REASON })
		expect(record_split_notice).toHaveBeenCalledWith(
			expect.objectContaining({ issue: LANE, single_reason: REASON }),
		)
		expect(issue_try_comment).toHaveBeenCalledWith(String(LANE), expect.stringContaining(REASON))
	})

	it('refuses a `--single` that names no reason, printing the usage', async () => {
		const tails = [['--single'], ['--single', '--probe']]
		const codes = await Promise.all(
			tails.map(async (tail) => {
				const argv = [...plan_of(PAST_CAP), ...tail]

				return await lane_plan_cli.run(argv, directory)
			}),
		)

		expect(codes).toStrictEqual([FAILURE, FAILURE])
		expect(error).toHaveBeenCalledWith(lane_plan_cli.USAGE)
		expect(lane_plan.read(LANE, directory)).toBeUndefined()
	})

	it('refuses a path after `--single` rather than taking it as the reason', async () => {
		const [issue = '', path_token = '', ...rest] = plan_of(PAST_CAP)
		const argv = [issue, '--single', path_token, ...rest]

		expect(await lane_plan_cli.run(argv, directory)).toBe(FAILURE)
		expect(error).toHaveBeenCalledWith(lane_plan_cli.USAGE)
		expect(lane_plan.read(LANE, directory)).toBeUndefined()
	})
})

describe('lane:plan --single re-plans before the first edit', () => {
	it('keeps the recorded reason on a re-plan without `--single`, posting it on the Issue once', async () => {
		await lane_plan_cli.run([...plan_of(PAST_CAP), '--single', REASON], directory)

		expect(await lane_plan_cli.run(plan_of(PAST_CAP), directory)).toBe(SUCCESS)
		expect(lane_plan.read(LANE, directory)).toMatchObject({ single: true, single_reason: REASON })
		expect(record_split_notice).toHaveBeenLastCalledWith(
			expect.objectContaining({ single_reason: REASON }),
		)
		expect(issue_try_comment).toHaveBeenCalledOnce()
	})

	it('posts a new reason a re-plan gives', async () => {
		const other = 'a migration whose halves cannot ship apart'

		await lane_plan_cli.run([...plan_of(PAST_CAP), '--single', REASON], directory)
		await lane_plan_cli.run([...plan_of(PAST_CAP), '--single', other], directory)

		expect(issue_try_comment).toHaveBeenCalledTimes(2)
		expect(issue_try_comment).toHaveBeenLastCalledWith(String(LANE), expect.stringContaining(other))
	})
})

describe('lane:plan in a dispatched lane after its first edit', () => {
	it('records the plan past the cap with a warning, noting nothing', async () => {
		is_edited.mockResolvedValue(true)

		expect(await lane_plan_cli.run(plan_of(PAST_CAP), directory)).toBe(SUCCESS)
		expect(error).toHaveBeenCalledWith(expect.stringContaining(WARNING))
		expect(record_split_notice).not.toHaveBeenCalled()
		expect(issue_try_comment).not.toHaveBeenCalled()
	})
})
