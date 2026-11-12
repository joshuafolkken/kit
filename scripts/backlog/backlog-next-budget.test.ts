import {
	auto_ok_fixture,
	CREATED_EARLIER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { gh_permission_cache } from '#scripts/gh/gh-permission-cache'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_conditional } from '#scripts/gh/git-gh-conditional'
import { git_gh_exec, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import {
	graphql_issue_node,
	graphql_labels,
	graphql_listing,
	is_listing_query,
} from '#scripts/gh/git-gh-issue-list-graphql-fixture'
import { rest_issue, rest_issue_page } from '#scripts/gh/git-gh-issue-rest-fixture'
import { conditional_read_over } from '#scripts/gh/git-gh-pr-fixture'
import { GRAPHQL_PATH } from '#scripts/gh/git-gh-pr-graphql-state'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { AUTO_OK_LABEL, EPIC_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'
import { backlog_resume_reads } from './backlog-resume-reads'

// joshuafolkken/kit#6610: the `gh` calls one `backlog:next` scan makes, counted on a fixed backlog of
// 11 epic children across three epics. The count is every read at the `gh` boundary the fixture
// stubs — the `git_gh_command` reads, the reachability probe, and the `exec_gh_api` reads the resume
// signals make for real here. #6611 reuses the listed rows for open children, so none is read on
// its own. #6560 lowers the second scan's cap, and #6613 keeps a member author's write role across
// scans, so a second scan asks none.

const { console_streams } = auto_ok_fixture
const GET_CHILD = 'issue_get_state_and_relations_classified'

const EPICS = [
	{ number: 950, children: [951, 952, 953, 954] },
	{ number: 960, children: [961, 962, 963, 964] },
	{ number: 970, children: [971, 972, 973] },
]
const CHILDREN = EPICS.flatMap((epic) => epic.children)
// Read per child before #6610 and #6611: its comments, its timeline, the repository's name and the
// child itself.
const PRE_FIX_READS_PER_CHILD = 4
// One open pull request listing and one GraphQL query, however many children there are.
const RESUME_READS = 2
// The listed children are candidates, so each one's body is read too (11 of the 21); without #6611
// the scan read each listed child again, 32 calls.
const SCAN_CALL_CAP = 21
const PRE_FIX_SCAN_CALLS = 63
// The second scan with nothing changed, measured: the epic listing and the three epic bodies come
// back 304, so they are not billed.
const SECOND_SCAN_CALL_CAP = 16

const streams = console_streams()

// joshuafolkken/kit#6613: a `MEMBER` author's write role is asked once and kept for the next process.
// Each scan below is a process of its own, so each uses a login the in-process memo has not seen.
const FIRST_SCAN_LOGIN = 'first-scan-member'
const SECOND_SCAN_LOGIN = 'second-scan-member'
const WRITE_ROLE = JSON.stringify({ permission: 'write', role_name: 'write' })
const PERMISSION_SEGMENT = '/permission'

type ChildRow = (child: number) => OpenIssueData

function comments_answer(): string {
	const window = { comments: { pageInfo: { hasPreviousPage: false }, nodes: [] } }
	const repository = Object.fromEntries(CHILDREN.map((child) => [`i${String(child)}`, window]))

	return JSON.stringify({ data: { repository } })
}

async function answer(request: GhApiRequest): Promise<string> {
	if (request.path.endsWith(PERMISSION_SEGMENT)) return WRITE_ROLE

	return request.path === GRAPHQL_PATH ? comments_answer() : ''
}

function owner_child(child: number): OpenIssueData {
	return auto_ok_fixture.issue(child, CREATED_EARLIER, [AUTO_OK_LABEL])
}

function member_child(login: string): ChildRow {
	return (child) => ({ ...owner_child(child), author_association: 'MEMBER', user: { login } })
}

// The children are opted in with their epics, so the listing returns each one's row.
function stub(is_listed = true, child_row: ChildRow = owner_child): void {
	const listed = is_listed ? CHILDREN : []

	backlog_fixture.stub_backlog({
		opted_in: [
			...EPICS.map((epic) =>
				auto_ok_fixture.issue(epic.number, CREATED_EARLIER, [AUTO_OK_LABEL, EPIC_LABEL]),
			),
			...listed.map((child) => child_row(child)),
		],
		epics: EPICS,
		children: CHILDREN.map((number) => ({ number })),
	})
	vi.mocked(backlog_resume_reads.paused_issues).mockRestore()
	vi.mocked(backlog_resume_reads.open_pr_issues).mockRestore()
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockImplementation(answer)
	// A member's permission lookup goes through the ETag layer (joshuafolkken/kit#6754).
	shared_cache_fixture.keep_in_memory()
	vi.spyOn(git_gh_conditional, 'read_conditional').mockImplementation(
		conditional_read_over(git_gh_exec.exec_gh_api),
	)
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

const EPIC_LISTING_QUERY = `labels=${EPIC_LABEL}&`
const EPIC_LABELS = [{ name: AUTO_OK_LABEL }, { name: EPIC_LABEL }]
const EMPTY_LISTING = '[]'

function task_list(children: ReadonlyArray<number>): string {
	return children.map((child) => `- [ ] #${String(child)}`).join('\n')
}

function issue_number_of(path: string): number | undefined {
	const digits = /\/issues\/(?<number>\d+)$/u.exec(path)?.groups?.['number']

	return digits === undefined ? undefined : Number(digits)
}

// The REST reads #6560 sends conditionally: the epic listing, each epic's body and each child.
function rest_answer(path: string): string {
	if (path.includes(EPIC_LISTING_QUERY)) {
		return rest_issue_page(
			EPICS.map((epic) => ({
				number: epic.number,
				body: task_list(epic.children),
				labels: EPIC_LABELS,
			})),
		)
	}

	const number = issue_number_of(path)
	const epic = EPICS.find((candidate) => candidate.number === number)

	if (epic !== undefined) return rest_issue({ number, body: task_list(epic.children) })

	return number === undefined ? EMPTY_LISTING : rest_issue({ number })
}

async function routed_answer(request: GhApiRequest): Promise<string> {
	return request.path === GRAPHQL_PATH || request.path.includes('/pulls')
		? await answer(request)
		: rest_answer(request.path)
}

// The epic listing and the epic bodies read for real through the ETag layer, over records kept in
// this test's memory so a second scan finds the first scan's ETags as a fresh process would on disk.
function serve_rest_reads(): void {
	shared_cache_fixture.keep_in_memory()
	vi.mocked(git_gh_command.issue_list_by_label).mockRestore()
	vi.mocked(git_gh_command.issue_get_body_classified).mockRestore()
	vi.mocked(git_gh_exec.exec_gh_api).mockImplementation(routed_answer)
	vi.spyOn(git_gh_conditional, 'read_conditional').mockImplementation(
		conditional_read_over(git_gh_exec.exec_gh_api),
	)
}

function conditional_etags(): Array<string | undefined> {
	return vi.mocked(git_gh_conditional.read_conditional).mock.calls.map(([, etag]) => etag)
}

// A 304 costs no rate limit, so it is not billed.
function billed_calls(): number {
	const unchanged = vi
		.mocked(git_gh_conditional.read_conditional)
		.mock.settledResults.filter(
			(result) => result.type === 'fulfilled' && result.value.kind === 'unchanged',
		).length

	return scan_calls() - unchanged
}

function permission_reads(): number {
	return vi
		.mocked(git_gh_exec.exec_gh_api)
		.mock.calls.filter(([request]) => request.path.endsWith(PERMISSION_SEGMENT)).length
}

function reset_scan(is_listed = true, child_row: ChildRow = owner_child): void {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	vi.spyOn(console, 'warn').mockImplementation(streams.error)
	streams.reset()
	stub(is_listed, child_row)
}

async function scan_output(is_listed: boolean): Promise<string> {
	reset_scan(is_listed)
	await backlog_next.run([])

	return streams.stdout()
}

beforeEach(() => {
	reset_scan()
})

it('keeps one scan of 11 epic children under the gh call cap', async () => {
	expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
	expect(git_gh_exec.exec_gh_api).toHaveBeenCalledTimes(RESUME_READS)

	const calls = scan_calls()
	const pre_fix = calls - RESUME_READS + PRE_FIX_READS_PER_CHILD * CHILDREN.length

	expect(pre_fix).toBe(PRE_FIX_SCAN_CALLS)
	expect(calls).toBeLessThanOrEqual(SCAN_CALL_CAP)
})

it('reads no listed open epic child on its own', async () => {
	expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
	expect(git_gh_command[GET_CHILD]).not.toHaveBeenCalled()
})

// joshuafolkken/kit#6560: the epic listing and every body go out with the ETag the previous scan
// kept, each scan a fresh process. Unchanged, they are answered 304, which costs no rate limit, so
// the second scan's billed calls are the first scan's less every conditional read.
it('keeps the second scan under a lower cap when nothing changed', async () => {
	serve_rest_reads()
	expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)

	const first = billed_calls()

	vi.clearAllMocks()
	expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)

	expect(conditional_etags().every((etag) => etag !== undefined)).toBe(true)
	expect(first).toBeLessThanOrEqual(SCAN_CALL_CAP)
	expect(billed_calls()).toBeLessThanOrEqual(SECOND_SCAN_CALL_CAP)
})

it('asks a member author once in the first scan and keeps the write role', async () => {
	reset_scan(true, member_child(FIRST_SCAN_LOGIN))

	expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
	expect(permission_reads()).toBe(1)
	expect(gh_permission_cache.is_writer('', FIRST_SCAN_LOGIN)).toBe(true)
})

it('answers the second scan from the kept write role, under the gh call cap', async () => {
	reset_scan(true, member_child(SECOND_SCAN_LOGIN))
	gh_permission_cache.remember_writer('', SECOND_SCAN_LOGIN)

	expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
	expect(permission_reads()).toBe(0)
	expect(scan_calls()).toBeLessThanOrEqual(SCAN_CALL_CAP)
})

it('picks the same as an owner-authored backlog once the write role is kept', async () => {
	const by_owner = await scan_output(true)

	reset_scan(true, member_child(SECOND_SCAN_LOGIN))
	gh_permission_cache.remember_writer('', SECOND_SCAN_LOGIN)
	await backlog_next.run([])

	expect(streams.stdout()).toBe(by_owner)
})

// joshuafolkken/kit#6785: the same backlog with the pool read for real, in one GraphQL query — the
// listing spends no REST core request, and the scan picks what the stubbed listing made it pick.
function pool_node(number: number, labels: ReadonlyArray<string>): Record<string, unknown> {
	return graphql_issue_node({
		number,
		title: `issue ${String(number)}`,
		body: '',
		url: `https://github.com/joshuafolkken/kit/issues/${String(number)}`,
		createdAt: CREATED_EARLIER,
		labels: graphql_labels(labels),
	})
}

function pool_listing(): string {
	const epics = EPICS.map((epic) => pool_node(epic.number, [AUTO_OK_LABEL, EPIC_LABEL]))
	// Triaged, as `backlog_fixture` lists them, so the scan does not label them first.
	const children = CHILDREN.map((child) => pool_node(child, [AUTO_OK_LABEL, RUN_LANE_LABEL]))

	return graphql_listing([...epics, ...children])
}

async function pool_answer(request: GhApiRequest): Promise<string> {
	return is_listing_query(request.body) ? pool_listing() : await answer(request)
}

function serve_pool_query(): void {
	vi.mocked(git_gh_command.issue_list_by_label_summary).mockRestore()
	vi.mocked(git_gh_exec.exec_gh_api).mockImplementation(pool_answer)
}

function pool_reads(): Array<string> {
	return vi
		.mocked(git_gh_exec.exec_gh_api)
		.mock.calls.filter(
			([request]) =>
				is_listing_query(request.body) || request.path.includes(`labels=${AUTO_OK_LABEL}`),
		)
		.map(([request]) => request.path)
}

it('reads the pool in one GraphQL query and no REST core request', async () => {
	serve_pool_query()

	expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
	expect(pool_reads()).toStrictEqual([GRAPHQL_PATH])
	expect(scan_calls()).toBeLessThanOrEqual(SCAN_CALL_CAP)
})

it('picks the same through the GraphQL pool as through the listed rows', async () => {
	const listed = await scan_output(true)

	reset_scan()
	serve_pool_query()
	await backlog_next.run([])

	expect(streams.stdout()).toBe(listed)
})

it('answers the same as when every listed child is read on its own', async () => {
	const from_reads = await scan_output(false)

	expect(await scan_output(true)).toBe(from_reads)
})
