import { git_gh_issue } from '#scripts/git/git-gh-issue'
import { AUTO_OK_LABEL } from '#scripts/git/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auto_ok_cli } from './auto-ok-cli'
import {
	auto_ok_fixture,
	BLOCKER_NUMBER,
	CLOSED_SPELLING,
	CREATED_EARLIER,
	CREATED_LATER,
	FAILURE_EXIT_CODE,
	IN_PROGRESS_SPELLING,
	NEW_ISSUE_NUMBER,
	OLD_ISSUE_NUMBER,
	OPEN_SPELLING,
	SUCCESS_EXIT_CODE,
} from './auto-ok-fixture'

// The findings joshuafolkken/kit#906's second review round left open, closed in kit#996: the pickup
// consulting no dependency, the cap notice contradicting the answer, both read failures naming the
// authentication, and `--exclude` taking a single number.

vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: { issue_list_by_label_summary: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/git/git-gh-command')
const issue_list = vi.mocked(git_gh_command.issue_list_by_label_summary)
const { issue, blocked_issue, capped_listing, record } = auto_ok_fixture

const stdout_lines: Array<string> = []
const stderr_lines: Array<string> = []

function stdout(): string {
	return stdout_lines.join('\n')
}

function stderr(): string {
	return stderr_lines.join('\n')
}

// A blocker carrying `state`, and one reported without it — the second is what a `gh` answer missing
// the field looks like, which must read as still standing rather than as resolved.
function blocked_by(state: string): string {
	return JSON.stringify([
		blocked_issue(NEW_ISSUE_NUMBER, CREATED_LATER, [{ number: BLOCKER_NUMBER, state }]),
	])
}

function blocked_by_stateless(): string {
	return JSON.stringify([
		blocked_issue(NEW_ISSUE_NUMBER, CREATED_LATER, [{ number: BLOCKER_NUMBER }]),
	])
}

// A candidate whose blocker page is smaller than the count it reports — what `blockedBy(first:50)`
// answers for an issue with more than fifty blockers.
function paged_blockers(total_count: number): string {
	return JSON.stringify([
		{
			...issue(NEW_ISSUE_NUMBER, CREATED_LATER),
			blockedBy: {
				nodes: [{ number: BLOCKER_NUMBER, state: CLOSED_SPELLING }],
				totalCount: total_count,
			},
		},
	])
}

function two_issues(): string {
	return JSON.stringify([
		issue(NEW_ISSUE_NUMBER, CREATED_LATER),
		issue(OLD_ISSUE_NUMBER, CREATED_EARLIER),
	])
}

vi.spyOn(console, 'info').mockImplementation(record(stdout_lines))
vi.spyOn(console, 'error').mockImplementation(record(stderr_lines))

beforeEach(() => {
	vi.clearAllMocks()
	stdout_lines.length = 0
	stderr_lines.length = 0
})

// `auto-ok` says the issue needs no decision. It says nothing about ordering, so without a
// dependency check a person applying the label let an unattended run start work before the issue it
// depends on.
describe('josh auto-ok:next — an issue whose prerequisite is still open', () => {
	it('does not answer an issue blocked by an open issue', async () => {
		issue_list.mockResolvedValueOnce(blocked_by(OPEN_SPELLING))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(auto_ok_cli.NONE_TOKEN)
	})

	it('answers it once every blocker has closed', async () => {
		issue_list.mockResolvedValueOnce(blocked_by(CLOSED_SPELLING))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(NEW_ISSUE_NUMBER))
	})

	// A blocked newest issue must not hide an older runnable one. Filtering after the priority list —
	// which keeps only its first few rows — would answer `none` here.
	it('skips past a blocked issue to an older runnable one', async () => {
		issue_list.mockResolvedValueOnce(
			JSON.stringify([
				blocked_issue(NEW_ISSUE_NUMBER, CREATED_LATER, [
					{ number: BLOCKER_NUMBER, state: OPEN_SPELLING },
				]),
				issue(OLD_ISSUE_NUMBER, CREATED_EARLIER),
			]),
		)

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
	})

	// Deferring an issue costs a poll; implementing one out of order costs the ordering itself.
	it('treats a blocker of unknown state as still standing', async () => {
		issue_list.mockResolvedValueOnce(blocked_by_stateless())

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(auto_ok_cli.NONE_TOKEN)
	})

	it('says a standing blocker is among the reasons there is nothing to run', async () => {
		issue_list.mockResolvedValueOnce(blocked_by(OPEN_SPELLING))
		await auto_ok_cli.run([])

		expect(stderr()).toContain('blocked by an open issue')
	})
})

// `gh` returns `blockedBy(first:50)`, so `nodes` is a page while `totalCount` is exact — and the
// guard fails open by construction, so what it is given matters as much as what it does with it.
describe('josh auto-ok:next — what the guard is given', () => {
	// The guard fails open by construction: a candidate with no `blockedBy` at all is runnable, which
	// is right for an issue that declares no blockers and wrong for a query that stopped asking for
	// the field. Without this, dropping it from the field list would silently remove the guard with
	// every test above still green.
	it('asks gh for the blocker relation', () => {
		expect(git_gh_issue.PICKUP_FIELDS).toContain('blockedBy')
	})

	// Reading one closed blocker as "unblocked" when the count says a second exists would break the
	// fail-safe direction the rest of these blocks rely on.
	it('treats blockers beyond the returned page as still standing', async () => {
		issue_list.mockResolvedValueOnce(paged_blockers(2))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(auto_ok_cli.NONE_TOKEN)
	})

	it('answers when the page holds every blocker it counts', async () => {
		issue_list.mockResolvedValueOnce(paged_blockers(1))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(NEW_ISSUE_NUMBER))
	})
})

// The notice used to be printed before the answer was known, asserting "the answer below is opted
// in" — which contradicted the `none` that followed, in the one situation where the cap mattered.
describe('josh auto-ok:next — the cap notice agrees with the answer', () => {
	it('warns the answer may not be the highest priority when there is one', async () => {
		issue_list.mockResolvedValueOnce(capped_listing(auto_ok_cli.LISTING_LIMIT, [AUTO_OK_LABEL]))
		await auto_ok_cli.run([])

		expect(stderr()).toContain(auto_ok_cli.TRUNCATED_WITH_ANSWER)
		expect(stderr()).not.toContain(auto_ok_cli.TRUNCATED_WITHOUT_ANSWER)
	})

	it('warns an older opted-in issue may still be runnable when everything listed was excluded', async () => {
		issue_list.mockResolvedValueOnce(
			capped_listing(auto_ok_cli.LISTING_LIMIT, [AUTO_OK_LABEL, IN_PROGRESS_SPELLING]),
		)

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(auto_ok_cli.NONE_TOKEN)
		expect(stderr()).toContain(auto_ok_cli.TRUNCATED_WITHOUT_ANSWER)
		expect(stderr()).not.toContain(auto_ok_cli.TRUNCATED_WITH_ANSWER)
	})
})

// Both gaps used to print the message that says to check `gh auth status`, which is the wrong place
// to look when the listing arrived and only its fields were unexpected.
describe('josh auto-ok:next — why the listing could not be used', () => {
	it('sends an unexpected shape to the field list rather than the authentication', async () => {
		issue_list.mockResolvedValueOnce('[{"unexpected":true}]')

		expect(await auto_ok_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(stderr()).toContain(auto_ok_cli.UNEXPECTED_SHAPE_MESSAGE)
		expect(stderr()).not.toContain(auto_ok_cli.UNREADABLE_MESSAGE)
	})

	// A listing that never arrived, and valid JSON that is not a listing at all, are both gaps rather
	// than field changes — and neither may read as an empty listing (joshuafolkken/kit#950).
	it.each([
		['gh itself failed', undefined],
		['gh answered something that is not a listing', '{"message":"API rate limit exceeded"}'],
		['gh answered unparseable output', 'not json'],
	])('sends %s to the authentication check', async (_case, raw) => {
		issue_list.mockResolvedValueOnce(raw)

		expect(await auto_ok_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(stdout()).toBe('')
		expect(stderr()).toContain(auto_ok_cli.UNREADABLE_MESSAGE)
	})
})

// `--exclude` took one number, so a loop past its second pickup could only skip what it had just
// run — while the procedure itself says the `in-progress` label is not a guard to rely on.
describe('josh auto-ok:next — excluding more than one issue', () => {
	it('accepts a repeated flag', async () => {
		issue_list.mockResolvedValueOnce(two_issues())

		expect(
			await auto_ok_cli.run([
				'--exclude',
				String(NEW_ISSUE_NUMBER),
				'--exclude',
				String(OLD_ISSUE_NUMBER),
			]),
		).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(auto_ok_cli.NONE_TOKEN)
	})

	it('accepts a comma-separated list', async () => {
		issue_list.mockResolvedValueOnce(two_issues())
		await auto_ok_cli.run(['--exclude', `${String(NEW_ISSUE_NUMBER)},${String(OLD_ISSUE_NUMBER)}`])

		expect(stdout()).toBe(auto_ok_cli.NONE_TOKEN)
	})

	it('still answers the ones not excluded', async () => {
		issue_list.mockResolvedValueOnce(two_issues())
		await auto_ok_cli.run(['--exclude', String(NEW_ISSUE_NUMBER)])

		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
	})

	// A typo must not quietly narrow the exclusion into skipping nothing.
	it('refuses a list with an unusable entry', async () => {
		expect(await auto_ok_cli.run(['--exclude', `${String(NEW_ISSUE_NUMBER)},oops`])).toBe(
			FAILURE_EXIT_CODE,
		)
		expect(stderr()).toContain(auto_ok_cli.USAGE)
	})

	it('refuses a repeated flag missing its value', async () => {
		expect(await auto_ok_cli.run(['--exclude', String(NEW_ISSUE_NUMBER), '--exclude'])).toBe(
			FAILURE_EXIT_CODE,
		)
	})
})
