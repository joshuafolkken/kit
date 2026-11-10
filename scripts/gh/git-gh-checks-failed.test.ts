import { git_branch } from '#scripts/git/git-branch'
import { json_value } from '#scripts/lib/json-value'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { git_gh_checks_failed } from './git-gh-checks-failed'
import { git_gh_exec } from './git-gh-exec'
import {
	check_runs_pages,
	commit_check_runs_path,
	commit_status_path,
	gh_api_routes,
	PR_BRANCH,
	PR_HEAD_SHA,
	PR_NUMBER,
	pr_routes,
	status_pages,
	type GhApiAnswer,
} from './git-gh-pr-fixture'
import { forget_pr_numbers } from './git-gh-pr-read'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

vi.mock('#scripts/git/git-branch', () => ({
	git_branch: { current: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const OTHER_SHA = 'abc1234'
const ALL_DIGIT_SHA = '4815162'
const ACTIONS_URL = 'https://github.com/o/r/actions/runs/1/job/2'
const STATUS_URL = 'https://ci.example.com/build/3'

const COMPLETED = 'completed'

const FAILED_RUN = {
	id: 2,
	name: 'unit',
	status: COMPLETED,
	conclusion: 'failure',
	details_url: ACTIONS_URL,
}
const PASSING_RUN = { id: 3, name: 'lint', status: COMPLETED, conclusion: 'success' }
const SKIPPED_RUN = { id: 4, name: 'e2e', status: COMPLETED, conclusion: 'skipped' }
// GitHub answers `"conclusion": null` for a running check, parsed here from the wire form.
const RUNNING_RUN =
	json_value.parse_with('{"id":5,"name":"build","conclusion":null}', z.looseObject({})) ?? {}
const EXTERNAL_CI = 'external-ci'
const ERRORED_STATUS = { context: EXTERNAL_CI, state: 'error', target_url: STATUS_URL }
const PASSING_STATUS = { context: 'license', state: 'success', target_url: STATUS_URL }

function commit_routes(
	sha: string,
	runs: ReadonlyArray<Record<string, unknown>>,
	statuses: ReadonlyArray<Record<string, unknown>> = [],
): Record<string, string> {
	return {
		[commit_check_runs_path(sha)]: check_runs_pages(runs),
		[commit_status_path(sha)]: status_pages(statuses),
	}
}

function route(routes: Record<string, GhApiAnswer>): void {
	mocked_api.mockImplementation(gh_api_routes(routes))
}

beforeEach(() => {
	mocked_api.mockReset()
	forget_pr_numbers()
	vi.mocked(git_branch.current).mockResolvedValue(PR_BRANCH)
})

describe('git_gh_checks_failed.list_failed_checks — target', () => {
	it('reads the head commit of the numbered pull request', async () => {
		route(pr_routes({}, commit_routes(PR_HEAD_SHA, [FAILED_RUN])))

		const result = await git_gh_checks_failed.list_failed_checks(String(PR_NUMBER))

		expect(result.sha).toBe(PR_HEAD_SHA)
		expect(result.failed.map((check) => check.name)).toStrictEqual(['unit'])
	})

	it('reads a #-prefixed number as a pull request', async () => {
		route(pr_routes({}, commit_routes(PR_HEAD_SHA, [FAILED_RUN])))

		const result = await git_gh_checks_failed.list_failed_checks(`#${String(PR_NUMBER)}`)

		expect(result.sha).toBe(PR_HEAD_SHA)
	})

	it('reads an all-digit sha of 7 characters or more as a commit, not a pull request', async () => {
		route(commit_routes(ALL_DIGIT_SHA, [FAILED_RUN]))

		const result = await git_gh_checks_failed.list_failed_checks(ALL_DIGIT_SHA)

		expect(result.sha).toBe(ALL_DIGIT_SHA)
	})

	it('reads a commit sha as given, with no pull request lookup', async () => {
		route(commit_routes(OTHER_SHA, [FAILED_RUN]))

		const result = await git_gh_checks_failed.list_failed_checks(OTHER_SHA)

		expect(result.sha).toBe(OTHER_SHA)
		expect(result.failed).toHaveLength(1)
	})

	it("reads the current branch's pull request when no target is given", async () => {
		route(pr_routes({}, commit_routes(PR_HEAD_SHA, [FAILED_RUN])))

		const result = await git_gh_checks_failed.list_failed_checks()

		expect(result.sha).toBe(PR_HEAD_SHA)
		expect(git_branch.current).toHaveBeenCalledOnce()
	})

	it('refuses a target that is neither a number nor a sha', async () => {
		await expect(git_gh_checks_failed.list_failed_checks('main')).rejects.toThrow(
			'not a pull request number or commit sha: main',
		)
	})
})

describe('git_gh_checks_failed.list_failed_checks — filtering', () => {
	it('lists failed check runs and errored statuses, skipping passing, skipped and running ones', async () => {
		const runs = [FAILED_RUN, PASSING_RUN, SKIPPED_RUN, RUNNING_RUN]

		route(commit_routes(OTHER_SHA, runs, [ERRORED_STATUS, PASSING_STATUS]))

		const { failed } = await git_gh_checks_failed.list_failed_checks(OTHER_SHA)

		expect(failed).toStrictEqual([
			{ name: 'unit', conclusion: 'failure', url: ACTIONS_URL },
			{ name: EXTERNAL_CI, conclusion: 'error', url: STATUS_URL },
		])
	})

	it.each(['timed_out', 'cancelled', 'action_required', 'startup_failure'])(
		'lists a run concluded %s as failing',
		async (conclusion) => {
			route(commit_routes(OTHER_SHA, [{ ...FAILED_RUN, conclusion }]))

			const { failed } = await git_gh_checks_failed.list_failed_checks(OTHER_SHA)

			expect(failed.map((check) => check.conclusion)).toStrictEqual([conclusion])
		},
	)

	it('drops a failed run superseded by a newer run of the same check', async () => {
		const rerun = { ...FAILED_RUN, id: 9, conclusion: 'success' }

		route(commit_routes(OTHER_SHA, [FAILED_RUN, rerun]))

		const { failed } = await git_gh_checks_failed.list_failed_checks(OTHER_SHA)

		expect(failed).toStrictEqual([])
	})
})

describe('git_gh_checks_failed.report', () => {
	it('prints one line when nothing failed', async () => {
		route(commit_routes(OTHER_SHA, [PASSING_RUN], [PASSING_STATUS]))

		const output = await git_gh_checks_failed.report(OTHER_SHA)

		expect(output).toBe(`No failing checks on ${OTHER_SHA}.`)
	})

	it('prints a count and one line per failing check', async () => {
		route(commit_routes(OTHER_SHA, [FAILED_RUN], [ERRORED_STATUS]))

		const output = await git_gh_checks_failed.report(OTHER_SHA)

		expect(output.split('\n')).toStrictEqual([
			`2 failing check(s) on ${OTHER_SHA}:`,
			`- unit — failure — ${ACTIONS_URL}`,
			`- ${EXTERNAL_CI} — error — ${STATUS_URL}`,
		])
	})
})
