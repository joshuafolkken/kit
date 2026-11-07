import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forget_branch_rules } from './git-gh-branch-rules'
import { git_gh_conditional } from './git-gh-conditional'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_poll_read } from './git-gh-poll-read'
import {
	check_runs_pages,
	commit_check_runs_path,
	commit_status_path,
	conditional_read_over,
	gh_api_routes,
	PR_BRANCH,
	pr_detail_path,
	pr_routes,
	status_pages,
} from './git-gh-pr-fixture'
import { GRAPHQL_PATH } from './git-gh-pr-graphql-state'
import { forget_pr_numbers } from './git-gh-pr-read'
import { pr_get_checks_snapshot } from './git-gh-pr-snapshot'
import { parse_pr_state_snapshot, type PrStateSnapshot } from './git-pr-checks-parse'

// The merge gate's pull request detail read through the poll ETag: a tick on an unchanged pull
// request costs no REST core read, and its lazily computed state comes from GraphQL
// (joshuafolkken/kit#6721).

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

vi.mock('./git-gh-conditional', () => ({
	git_gh_conditional: { read_conditional: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const mocked_conditional = vi.mocked(git_gh_conditional.read_conditional)

const NODE_ID = 'PR_kwDOnode'
const CLEAN_ANSWER = JSON.stringify({ data: { node: { mergeStateStatus: 'CLEAN' } } })

const COMMIT_ROUTES = {
	[commit_check_runs_path()]: check_runs_pages([]),
	[commit_status_path()]: status_pages([]),
}
const GRAPHQL_ROUTES = { ...COMMIT_ROUTES, [GRAPHQL_PATH]: CLEAN_ANSWER }

// `extra` without the GraphQL route stands for GraphQL refusing the state, as a cloud session's 403.
function route(
	pull: Record<string, unknown>,
	extra: Record<string, string> = GRAPHQL_ROUTES,
): void {
	const routes = pr_routes({ node_id: NODE_ID, ...pull }, extra)

	mocked_api.mockImplementation(gh_api_routes(routes))
}

async function read_tick(): Promise<PrStateSnapshot> {
	const checks = await pr_get_checks_snapshot(PR_BRANCH)

	return parse_pr_state_snapshot(checks.snapshot_json)
}

// The detail answers 304 without asking the router, as GitHub's own 304 sends no GET's worth of quota.
function answer_detail_unchanged(): void {
	const fresh = conditional_read_over(mocked_api)

	mocked_conditional.mockImplementation(async (path, etag) =>
		etag !== undefined && path === pr_detail_path()
			? { kind: 'unchanged' }
			: await fresh(path, etag),
	)
}

function detail_reads(): number {
	return mocked_api.mock.calls.filter(([request]) => request.path === pr_detail_path()).length
}

beforeEach(() => {
	mocked_api.mockReset()
	mocked_conditional.mockImplementation(conditional_read_over(mocked_api))
	forget_pr_numbers()
	forget_branch_rules()
	git_gh_poll_read.forget_poll_reads()
})

describe('pr_get_checks_snapshot — the detail read through the poll ETag', () => {
	it('sends no unconditional detail GET on a tick where the pull request has not changed', async () => {
		route({ mergeable_state: 'blocked' })
		await read_tick()
		answer_detail_unchanged()
		mocked_api.mockClear()

		const snapshot = await read_tick()

		expect(detail_reads()).toBe(0)
		expect(snapshot.merge_state_status).toBe('CLEAN')
	})

	it('reads the detail unconditionally where GraphQL does not answer the state', async () => {
		route({ mergeable_state: 'blocked' })
		await read_tick()
		answer_detail_unchanged()
		mocked_api.mockClear()
		route({ mergeable_state: 'clean' }, COMMIT_ROUTES)

		const snapshot = await read_tick()

		expect(detail_reads()).toBe(1)
		expect(snapshot.merge_state_status).toBe('CLEAN')
	})

	// The real conditional read answers a failure as `unreadable` rather than throwing.
	it('reads the detail unconditionally where the conditional read fails', async () => {
		route({ mergeable_state: 'clean' })
		const fresh = conditional_read_over(mocked_api)

		mocked_conditional.mockImplementation(async (path, etag) =>
			path === pr_detail_path() ? { kind: 'unreadable' } : await fresh(path, etag),
		)

		const snapshot = await read_tick()

		expect(detail_reads()).toBe(1)
		expect(snapshot.merge_state_status).toBe('CLEAN')
	})
})

describe('pr_get_checks_snapshot — a detail answered 200', () => {
	it('takes the new detail on a tick where the pull request changed under a new ETag', async () => {
		route({ mergeable_state: 'blocked' })
		await read_tick()
		route({ mergeable_state: 'dirty', merged: true })

		const snapshot = await read_tick()

		expect(snapshot.merge_state_status).toBe('DIRTY')
		expect(snapshot.is_merged).toBe(true)
	})

	it('leaves merged unset on an open pull request', async () => {
		route({ mergeable_state: 'clean' })

		const snapshot = await read_tick()

		expect(snapshot.is_merged).toBeUndefined()
	})
})
