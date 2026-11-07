import {
	auto_ok_fixture,
	CREATED_EARLIER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import { GRAPHQL_PATH } from '#scripts/gh/git-gh-pr-graphql-state'
import { AUTO_OK_LABEL, EPIC_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'
import { backlog_resume_reads } from './backlog-resume-reads'

// joshuafolkken/kit#6610: the `gh` calls one `backlog:next` scan makes, counted on a fixed backlog of
// 11 epic children across three epics. The count is every read at the `gh` boundary the fixture
// stubs — the `git_gh_command` reads, the reachability probe, and the `exec_gh_api` reads the resume
// signals make for real here. The rest of the epic (#6611, #6613) lowers `SCAN_CALL_CAP`.

const { console_streams } = auto_ok_fixture

const EPICS = [
	{ number: 950, children: [951, 952, 953, 954] },
	{ number: 960, children: [961, 962, 963, 964] },
	{ number: 970, children: [971, 972, 973] },
]
const CHILDREN = EPICS.flatMap((epic) => epic.children)
// Read per child before #6610: its comments, its timeline and the repository's name.
const PRE_FIX_READS_PER_CHILD = 3
// One open pull request listing and one GraphQL query, however many children there are.
const RESUME_READS = 2
const SCAN_CALL_CAP = 21
const PRE_FIX_SCAN_CALLS = 52

const streams = console_streams()

function comments_answer(): string {
	const window = { comments: { pageInfo: { hasPreviousPage: false }, nodes: [] } }
	const repository = Object.fromEntries(CHILDREN.map((child) => [`i${String(child)}`, window]))

	return JSON.stringify({ data: { repository } })
}

async function answer(request: GhApiRequest): Promise<string> {
	return request.path === GRAPHQL_PATH ? comments_answer() : ''
}

function stub(): void {
	backlog_fixture.stub_backlog({
		opted_in: EPICS.map((epic) =>
			auto_ok_fixture.issue(epic.number, CREATED_EARLIER, [AUTO_OK_LABEL, EPIC_LABEL]),
		),
		epics: EPICS,
		children: CHILDREN.map((number) => ({ number })),
	})
	vi.mocked(backlog_resume_reads.paused_issues).mockRestore()
	vi.mocked(backlog_resume_reads.open_pr_issues).mockRestore()
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockImplementation(answer)
}

function calls_of(value: unknown): number {
	return vi.isMockFunction(value) ? value.mock.calls.length : 0
}

function scan_calls(): number {
	const command_calls = Object.values(git_gh_command).reduce(
		(total: number, read) => total + calls_of(read),
		0,
	)

	const exec_calls = calls_of(git_gh_exec.exec_gh_api_status) + calls_of(git_gh_exec.exec_gh_api)

	return command_calls + exec_calls
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	vi.spyOn(console, 'warn').mockImplementation(streams.error)
	streams.reset()
	stub()
})

it('keeps one scan of 11 epic children under the gh call cap', async () => {
	expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
	expect(git_gh_exec.exec_gh_api).toHaveBeenCalledTimes(RESUME_READS)

	const calls = scan_calls()
	const pre_fix = calls - RESUME_READS + PRE_FIX_READS_PER_CHILD * CHILDREN.length

	expect(pre_fix).toBe(PRE_FIX_SCAN_CALLS)
	expect(calls).toBeLessThanOrEqual(SCAN_CALL_CAP)
})
