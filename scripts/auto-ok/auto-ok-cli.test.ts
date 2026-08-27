import { AUTO_OK_LABEL } from '#scripts/git/issue-labels'
import type { OpenIssueData } from '#scripts/git/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auto_ok_cli } from './auto-ok-cli'

vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: { issue_list_by_label_summary: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/git/git-gh-command')
const issue_list = vi.mocked(git_gh_command.issue_list_by_label_summary)

const CREATED_EARLIER = '2026-08-01T00:00:00Z'
const CREATED_LATER = '2026-08-02T00:00:00Z'
const OLD_ISSUE_NUMBER = 700
const NEW_ISSUE_NUMBER = 900
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const IN_PROGRESS_SPELLING = 'in-progress'

// The two streams the contract is about: one token on standard output for a loop to branch on, and
// every explanation on standard error. Captured as text rather than read off the spy, which types
// its calls as `any`.
const stdout_lines: Array<string> = []
const stderr_lines: Array<string> = []

function record(lines: Array<string>): (...args: Array<unknown>) => void {
	return (...args: Array<unknown>): void => {
		lines.push(args.map(String).join(' '))
	}
}

vi.spyOn(console, 'info').mockImplementation(record(stdout_lines))
vi.spyOn(console, 'error').mockImplementation(record(stderr_lines))

function stdout(): string {
	return stdout_lines.join('\n')
}

function stderr(): string {
	return stderr_lines.join('\n')
}

function issue(
	number: number,
	created_at: string,
	labels: ReadonlyArray<string> = [AUTO_OK_LABEL],
): OpenIssueData {
	return {
		number,
		title: `issue ${String(number)}`,
		createdAt: created_at,
		labels: labels.map((name) => ({ name })),
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	stdout_lines.length = 0
	stderr_lines.length = 0
})

describe('josh auto-ok:next — the token on standard output', () => {
	it('answers the newest opted-in issue, matching the next-issues display order', async () => {
		issue_list.mockResolvedValueOnce(
			JSON.stringify([
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
		issue_list.mockResolvedValueOnce('[]')

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(auto_ok_cli.NONE_TOKEN)
	})

	it('asks GitHub for the opt-in label, not for some other listing', async () => {
		issue_list.mockResolvedValueOnce('[]')
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
				JSON.stringify([issue(NEW_ISSUE_NUMBER, CREATED_LATER, [AUTO_OK_LABEL, label])]),
			)

			expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
			expect(stdout()).toBe(auto_ok_cli.NONE_TOKEN)
		},
	)

	it('falls through to the next candidate when the newest one is excluded', async () => {
		issue_list.mockResolvedValueOnce(
			JSON.stringify([
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
			JSON.stringify([
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
		issue_list.mockResolvedValueOnce('[]')
		await auto_ok_cli.run([])

		expect(stderr()).toContain(auto_ok_cli.NONE_OPTED_IN_MESSAGE)
	})

	// Telling a person the label is absent when it is applied sends them to apply it again.
	it('says the candidates were excluded when they were', async () => {
		issue_list.mockResolvedValueOnce(
			JSON.stringify([issue(NEW_ISSUE_NUMBER, CREATED_LATER, [AUTO_OK_LABEL, 'epic'])]),
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
		// Valid JSON, valid array, wrong elements: the zod rejection would otherwise escape as a
		// stack trace instead of the sentence this command exists to print.
		['gh answered a listing whose rows are the wrong shape', '[{"unexpected":true}]'],
	])('exits non-zero when %s', async (_case, raw) => {
		issue_list.mockResolvedValueOnce(raw)

		expect(await auto_ok_cli.run([])).toBe(FAILURE_EXIT_CODE)
		// Nothing on standard output: a caller reading a token must not see `none` here.
		expect(stdout()).toBe('')
		expect(stderr()).toContain(auto_ok_cli.UNREADABLE_MESSAGE)
	})
})

describe('josh auto-ok:next — a truncated listing says so', () => {
	// `gh` lists newest first, so the cap drops the oldest opted-in issues. The answer is still an
	// opted-in issue, which is why this warns rather than refusing.
	it('warns when the listing filled the cap', async () => {
		const rows = Array.from({ length: auto_ok_cli.LISTING_LIMIT }, (_value, index) =>
			issue(index + 1, CREATED_EARLIER),
		)

		issue_list.mockResolvedValueOnce(JSON.stringify(rows))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stderr()).toContain(auto_ok_cli.TRUNCATED_MESSAGE)
	})

	it('stays quiet when the listing is short of the cap', async () => {
		issue_list.mockResolvedValueOnce(JSON.stringify([issue(NEW_ISSUE_NUMBER, CREATED_LATER)]))
		await auto_ok_cli.run([])

		expect(stderr()).not.toContain(auto_ok_cli.TRUNCATED_MESSAGE)
	})
})
