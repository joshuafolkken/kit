import { listing_of, listing_outcome } from '#scripts/git/git-gh-issue-list-fixture'
import { AUTO_OK_LABEL } from '#scripts/git/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auto_ok_cli } from './auto-ok-cli'
import {
	auto_ok_fixture,
	CREATED_EARLIER,
	CREATED_LATER,
	FAILURE_EXIT_CODE,
	IN_PROGRESS_SPELLING,
	NEW_ISSUE_NUMBER,
	OLD_ISSUE_NUMBER,
	SUCCESS_EXIT_CODE,
} from './auto-ok-fixture'

const { issue, record } = auto_ok_fixture

vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: { issue_list_by_label_summary: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/git/git-gh-command')
const issue_list = vi.mocked(git_gh_command.issue_list_by_label_summary)

// The two streams the contract is about: one token on standard output for a loop to branch on, and
// every explanation on standard error. Captured as text rather than read off the spy, which types
// its calls as `any`.
const stdout_lines: Array<string> = []
const stderr_lines: Array<string> = []

vi.spyOn(console, 'info').mockImplementation(record(stdout_lines))
vi.spyOn(console, 'error').mockImplementation(record(stderr_lines))

function stdout(): string {
	return stdout_lines.join('\n')
}

function stderr(): string {
	return stderr_lines.join('\n')
}

beforeEach(() => {
	vi.clearAllMocks()
	// The default answer for a call the case did not queue one for. Every wrapper answers
	// `{ json, is_capped }` since joshuafolkken/kit#1067, so a bare `vi.fn()` returning `undefined`
	// is a shape no caller can be handed — and the failed-read path is what an unqueued call means.
	issue_list.mockResolvedValue(listing_outcome(undefined))
	stdout_lines.length = 0
	stderr_lines.length = 0
})

describe('josh auto-ok:next — the token on standard output', () => {
	it('answers the newest opted-in issue, matching the next-issues display order', async () => {
		issue_list.mockResolvedValueOnce(
			listing_of([
				issue(OLD_ISSUE_NUMBER, CREATED_EARLIER),
				issue(NEW_ISSUE_NUMBER, CREATED_LATER),
			]),
		)

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(NEW_ISSUE_NUMBER))
	})

	// Opting in is the default absence: a repository that has never used the label answers this on
	// every run, and the run then finishes exactly as it did before the label existed.
	it('answers none when no open issue carries the label', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(auto_ok_cli.NONE_TOKEN)
	})

	it('asks GitHub for the opt-in label, not for some other listing', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))
		await auto_ok_cli.run([])

		expect(issue_list).toHaveBeenCalledWith(AUTO_OK_LABEL, auto_ok_cli.LISTING_LIMIT)
	})
})

describe('josh auto-ok:next — what it refuses to run', () => {
	// The three labels mean the same thing here as in the next-issues display: an epic is never run
	// directly, an `in-progress` issue is already claimed, and a parked one cannot finish.
	it.each(['epic', 'Epic', IN_PROGRESS_SPELLING, 'needs-decision', 'Needs-Decision'])(
		'skips an opted-in issue also carrying %s',
		async (label) => {
			issue_list.mockResolvedValueOnce(
				listing_of([issue(NEW_ISSUE_NUMBER, CREATED_LATER, [AUTO_OK_LABEL, label])]),
			)

			expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
			expect(stdout()).toBe(auto_ok_cli.NONE_TOKEN)
		},
	)

	it('falls through to the next candidate when the newest one is excluded', async () => {
		issue_list.mockResolvedValueOnce(
			listing_of([
				issue(NEW_ISSUE_NUMBER, CREATED_LATER, [AUTO_OK_LABEL, IN_PROGRESS_SPELLING]),
				issue(OLD_ISSUE_NUMBER, CREATED_EARLIER),
			]),
		)

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
	})

	it('refuses an argument rather than answering about it', async () => {
		expect(await auto_ok_cli.run(['--help'])).toBe(FAILURE_EXIT_CODE)
		expect(stdout()).toBe('')
	})
})

describe('josh auto-ok:next — the issue just merged', () => {
	// GitHub applies the `closes #N` side effect asynchronously, so for a few seconds after a merge
	// the picked-up issue is still listed as open. Without this the loop can hand the same number
	// back and re-implement work that already shipped.
	it('excludes the number the caller names', async () => {
		issue_list.mockResolvedValueOnce(
			listing_of([
				issue(NEW_ISSUE_NUMBER, CREATED_LATER),
				issue(OLD_ISSUE_NUMBER, CREATED_EARLIER),
			]),
		)

		expect(await auto_ok_cli.run(['--exclude', String(NEW_ISSUE_NUMBER)])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
	})

	it.each([
		['a missing value', ['--exclude']],
		['a value that is not a number', ['--exclude', 'nine hundred']],
		['a trailing extra argument', ['--exclude', '900', 'extra']],
		['an unknown flag', ['--all']],
	])('refuses %s', async (_case, argv) => {
		expect(await auto_ok_cli.run(argv)).toBe(FAILURE_EXIT_CODE)
		expect(stdout()).toBe('')
		expect(stderr()).toContain(auto_ok_cli.USAGE)
	})
})

describe('josh auto-ok:next — why there is nothing to run', () => {
	it('says the label is absent when it is', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))
		await auto_ok_cli.run([])

		expect(stderr()).toContain(auto_ok_cli.NONE_OPTED_IN_MESSAGE)
	})

	// Telling a person the label is absent when it is applied sends them to apply it again.
	it('says the candidates were excluded when they were', async () => {
		issue_list.mockResolvedValueOnce(
			listing_of([issue(NEW_ISSUE_NUMBER, CREATED_LATER, [AUTO_OK_LABEL, 'epic'])]),
		)
		await auto_ok_cli.run([])

		expect(stderr()).not.toContain(auto_ok_cli.NONE_OPTED_IN_MESSAGE)
		expect(stderr()).toContain('excluded')
	})
})

describe('josh auto-ok:next — a listing it could not read is not an empty one', () => {
	it.each([
		['gh itself failed', undefined],
		['gh answered something that is not a listing', '{"message":"API rate limit exceeded"}'],
		['gh answered unparseable output', 'not json'],
	])('exits non-zero when %s', async (_case, raw) => {
		issue_list.mockResolvedValueOnce(listing_outcome(raw))

		expect(await auto_ok_cli.run([])).toBe(FAILURE_EXIT_CODE)
		// Nothing on standard output: a caller reading a token must not see `none` here.
		expect(stdout()).toBe('')
		expect(stderr()).toContain(auto_ok_cli.UNREADABLE_MESSAGE)
	})

	// Valid JSON, valid array, wrong elements: the zod rejection would otherwise escape as a stack
	// trace instead of the sentence this command exists to print. Since joshuafolkken/kit#996 it is
	// also the one case that names the field list rather than the authentication.
	it('exits non-zero when the listing rows are the wrong shape', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome('[{"unexpected":true}]'))

		expect(await auto_ok_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(stdout()).toBe('')
		expect(stderr()).toContain(auto_ok_cli.UNEXPECTED_SHAPE_MESSAGE)
	})

	// joshuafolkken/kit#1069: the listing has been REST since joshuafolkken/kit#1025 and
	// `git-gh-issue-list.ts` builds the JSON this command parses, so the CLI's version cannot be what
	// changed the row shape. Sending a reader to `gh --version` is the misdirection kit#996 removed
	// from the access message, standing one constant away from where kit#1005 removed it again.
	it('sends a wrong row shape to the field mapping rather than to the CLI version', () => {
		expect(auto_ok_cli.UNEXPECTED_SHAPE_MESSAGE).not.toContain('gh --version')
		expect(auto_ok_cli.UNEXPECTED_SHAPE_MESSAGE).toContain('git-gh-issue-rest.ts')
	})
})

describe('josh auto-ok:next — a truncated listing says so', () => {
	// The listing is newest first — `git-gh-issue-list.ts` asks for `sort=created&direction=desc` on
	// every request — so the cap drops the oldest opted-in issues. The answer is still an opted-in
	// issue, which is why this warns rather than refusing.
	it('warns when the listing filled the cap', async () => {
		const rows = Array.from({ length: auto_ok_cli.LISTING_LIMIT }, (_value, index) =>
			issue(index + 1, CREATED_EARLIER),
		)

		issue_list.mockResolvedValueOnce(listing_of(rows))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stderr()).toContain(auto_ok_cli.TRUNCATED_WITH_ANSWER)
	})

	it('stays quiet when the listing is short of the cap', async () => {
		issue_list.mockResolvedValueOnce(listing_of([issue(NEW_ISSUE_NUMBER, CREATED_LATER)]))
		await auto_ok_cli.run([])

		expect(stderr()).not.toContain(auto_ok_cli.TRUNCATED_WITH_ANSWER)
	})

	// joshuafolkken/kit#1067: the paging can now stop before the cap is filled, and a short listing
	// that nobody was told about is the silently reduced answer this whole change removes.
	it('warns when the paging stopped before the cap was filled', async () => {
		issue_list.mockResolvedValueOnce(listing_of([issue(NEW_ISSUE_NUMBER, CREATED_LATER)], true))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(NEW_ISSUE_NUMBER))
		expect(stderr()).toContain(auto_ok_cli.TRUNCATED_WITH_ANSWER)
	})

	// The two cuts cite different numbers because a reader who wants the listing widened reaches for
	// a different knob for each — the caller's cap, or the paging's ceiling.
	it('cites the page ceiling rather than the cap when the paging stopped', () => {
		expect(auto_ok_cli.truncated_cause('page_ceiling')).not.toBe(
			auto_ok_cli.truncated_cause('row_limit'),
		)
		expect(auto_ok_cli.truncated_cause('none')).toBeUndefined()
	})
})
