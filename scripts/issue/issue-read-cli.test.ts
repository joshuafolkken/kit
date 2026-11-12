import { readFileSync } from 'node:fs'
import { bash_output_cap_reader } from '#scripts/document/bash-output-cap'
import { capped_print_fixture } from '#scripts/document/capped-print-fixture'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { gh_rate_limit } from '#scripts/gh/git-gh-rate-limit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_read } from './issue-read'

const classified_mock = vi.hoisted(() => vi.fn())
const comments_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const error_mock = vi.hoisted(() => vi.fn())

// The combined read answers what its REST fallback's two reads would, so the cases keep stubbing those.
vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		async issue_read_with_comments(
			issue_number: string,
			fields: string,
			repo?: string,
		): Promise<{ read: unknown; comments_json: unknown }> {
			return {
				read: await classified_mock(issue_number, fields, repo),
				comments_json: await comments_mock(issue_number, undefined, repo),
			}
		},
	},
}))

const { issue_read_cli } = await import('./issue-read-cli')

// `josh issue:read` — the command that collapses the two `gh api` reads `issue-comments.md` requires per issue into
// one call (joshuafolkken/kit#1715).
//
// The cases are about what the batch must not lose: a number that resolves to nothing is named rather
// than silently missing from the output, and a comment listing that failed is reported as failed
// rather than as an issue with no comments.

const SUCCESS = 0
const FAILURE = 1
// A thread of `cap / 10` thirty-character lines runs to three times the cap.
const LINE_FRACTION = 10
const ISSUE = '1715'
const OTHER_ISSUE = '1567'
const REPO = 'joshuafolkken/app-kit'
const FIELDS_JSON = JSON.stringify({ title: 'A title', state: 'open', body: 'The body' })
const READ = { kind: 'read', json: FIELDS_JSON }
// An author with write access, whose comment body `issue:read` prints whole.
const TRUSTED = 'OWNER'
const COMMENTS_JSON = JSON.stringify([
	{
		user: { login: 'someone' },
		author_association: TRUSTED,
		created_at: 'then',
		body: 'A comment',
	},
])

function printed(): string {
	return info_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

function reported(): string {
	return error_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

beforeEach(() => {
	classified_mock.mockReset()
	comments_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
	info_mock.mockReset()
	error_mock.mockReset()
})

describe('issue_read_cli.parse_numbers', () => {
	it('reads the numbers in the order they were typed', () => {
		expect(issue_read_cli.parse_numbers([OTHER_ISSUE, ISSUE])).toEqual([OTHER_ISSUE, ISSUE])
	})

	it('drops a repeated number rather than reading it twice', () => {
		expect(issue_read_cli.parse_numbers([ISSUE, ISSUE])).toEqual([ISSUE])
	})

	// A dropped token answers fewer numbers than were asked for and still exits zero, so nothing in
	// the output says a number went unanswered.
	it('refuses the whole call when a token is not an issue number', () => {
		expect(issue_read_cli.parse_numbers([`#${ISSUE}`])).toBeUndefined()
		expect(issue_read_cli.parse_numbers([])).toBeUndefined()
	})
})

// joshuafolkken/kit#5851: the flag follows `issue:state`'s rules — an empty, repeated or misspelled
// `--repo` refuses rather than falling back to the session's repository.
describe('issue_read_cli.parse_request', () => {
	it('reads --repo beside the numbers, in either spelling', () => {
		const expected = { issue_numbers: [ISSUE], repo: REPO }

		expect(issue_read_cli.parse_request([ISSUE, '--repo', REPO])).toEqual(expected)
		expect(issue_read_cli.parse_request([`--repo=${REPO}`, ISSUE])).toEqual(expected)
	})

	it('names no repository when --repo is absent', () => {
		expect(issue_read_cli.parse_request([ISSUE])).toEqual({ issue_numbers: [ISSUE] })
	})

	it('refuses an empty, repeated or misspelled --repo', () => {
		expect(issue_read_cli.parse_request([ISSUE, '--repo='])).toBeUndefined()
		expect(issue_read_cli.parse_request([ISSUE, '--repo', REPO, '--repo', REPO])).toBeUndefined()
		expect(issue_read_cli.parse_request([ISSUE, `--rep=${REPO}`])).toBeUndefined()
	})
})

// joshuafolkken/kit#5851: a body from one repository beside the comments of another is a block about
// two different issues of the same number.
describe('issue_read_cli.run — the repository it reads', () => {
	it('reads the body and the comments from the repository --repo names', async () => {
		classified_mock.mockResolvedValue(READ)
		comments_mock.mockResolvedValue(COMMENTS_JSON)

		expect(await issue_read_cli.run([ISSUE, '--repo', REPO])).toBe(SUCCESS)
		expect(classified_mock).toHaveBeenCalledWith(ISSUE, expect.any(String), REPO)
		expect(comments_mock).toHaveBeenCalledWith(ISSUE, undefined, REPO)
	})

	// The trust lookup follows the read: an author's write access is asked of the repository named.
	it('judges the authors against the repository --repo names', async () => {
		const parse_fields = vi.spyOn(issue_read, 'parse_issue_fields')
		const parse_comments = vi.spyOn(issue_read, 'parse_comments')

		classified_mock.mockResolvedValue(READ)
		comments_mock.mockResolvedValue(COMMENTS_JSON)

		await issue_read_cli.run([ISSUE, '--repo', REPO])

		expect(parse_fields).toHaveBeenCalledWith(FIELDS_JSON, REPO)
		expect(parse_comments).toHaveBeenCalledWith(COMMENTS_JSON, REPO)
	})

	it('reads the session repository when no --repo is given', async () => {
		classified_mock.mockResolvedValue(READ)
		comments_mock.mockResolvedValue(COMMENTS_JSON)

		await issue_read_cli.run([ISSUE])

		expect(classified_mock).toHaveBeenCalledWith(ISSUE, expect.any(String), undefined)
		expect(comments_mock).toHaveBeenCalledWith(ISSUE, undefined, undefined)
	})
})

describe('issue_read_cli.run', () => {
	it('prints one block per issue, from one call', async () => {
		classified_mock.mockResolvedValue(READ)
		comments_mock.mockResolvedValue(COMMENTS_JSON)

		expect(await issue_read_cli.run([ISSUE, OTHER_ISSUE])).toBe(SUCCESS)
		expect(printed()).toContain(`${issue_read.ISSUE_LABEL}${ISSUE}`)
		expect(printed()).toContain(`${issue_read.ISSUE_LABEL}${OTHER_ISSUE}`)
		expect(printed()).toContain('A comment')
	})

	// The whole point of the command: two issues cost two reads each, and one turn rather than four.
	it('reads the body and the comments of every number named', async () => {
		classified_mock.mockResolvedValue(READ)
		comments_mock.mockResolvedValue(COMMENTS_JSON)

		await issue_read_cli.run([ISSUE, OTHER_ISSUE])

		expect(classified_mock).toHaveBeenCalledTimes(2)
		expect(comments_mock).toHaveBeenCalledTimes(2)
	})
})

// joshuafolkken/kit#4663: `run:entry` gates an untrusted author's issue on what this read decided.
describe('issue_read_cli.read_block — the trust it carries', () => {
	it('reports an untrusted body and a trusted comment', async () => {
		classified_mock.mockResolvedValue(READ)
		comments_mock.mockResolvedValue(COMMENTS_JSON)

		const block = await issue_read_cli.read_block(ISSUE)

		expect(block).toMatchObject({
			kind: 'ok',
			trust: { is_body_trusted: false, has_trusted_comment: true },
		})
	})

	// joshuafolkken/kit#4703: a listing nobody read answers nothing, so `run:entry` names the failed read.
	it('leaves the trusted comment unanswered when the listing could not be read', async () => {
		classified_mock.mockResolvedValue(READ)
		comments_mock.mockResolvedValue(undefined)

		const block = await issue_read_cli.read_block(ISSUE)

		expect(block).toMatchObject({ trust: { has_trusted_comment: undefined } })
	})

	it('reports no trusted comment when every comment was read and none is trusted', async () => {
		const untrusted = [{ user: { login: 'stranger' }, author_association: 'NONE', body: 'x' }]

		classified_mock.mockResolvedValue(READ)
		comments_mock.mockResolvedValue(JSON.stringify(untrusted))

		const block = await issue_read_cli.read_block(ISSUE)

		expect(block).toMatchObject({ trust: { has_trusted_comment: false } })
	})
})

describe('issue_read_cli.run — a number that produced nothing', () => {
	it('names a number that resolves to nothing, and exits non-zero', async () => {
		classified_mock.mockResolvedValue({ kind: 'missing' })
		comments_mock.mockResolvedValue(undefined)

		expect(await issue_read_cli.run([ISSUE])).toBe(FAILURE)
		expect(reported()).toContain(ISSUE)
	})

	it('keeps the issues that read when one number does not', async () => {
		classified_mock.mockResolvedValueOnce(READ).mockResolvedValueOnce({ kind: 'unreadable' })
		comments_mock.mockResolvedValue('[]')

		expect(await issue_read_cli.run([ISSUE, OTHER_ISSUE])).toBe(FAILURE)
		expect(printed()).toContain(`${issue_read.ISSUE_LABEL}${ISSUE}`)
		expect(reported()).toContain(OTHER_ISSUE)
	})

	// A block showing no comment where the listing failed hands the reader a body a comment may
	// already have overturned — the misread `issue-comments.md` exists to prevent.
	it('says the comments could not be read rather than showing none', async () => {
		classified_mock.mockResolvedValue(READ)
		comments_mock.mockResolvedValue(undefined)

		expect(await issue_read_cli.run([ISSUE])).toBe(SUCCESS)
		expect(printed()).toContain(issue_read.COMMENTS_UNREADABLE)
	})

	it('prints the usage and exits non-zero when nothing usable was given', async () => {
		expect(await issue_read_cli.run([])).toBe(FAILURE)
		expect(reported()).toContain(issue_read_cli.USAGE)
	})

	it('names --repo in the usage it prints', async () => {
		expect(await issue_read_cli.run([ISSUE, '--rep=x'])).toBe(FAILURE)
		expect(reported()).toContain('[--repo <owner/repo>]')
	})
})

// joshuafolkken/kit#6614: a rate-limited read was reported with the same guess as expired auth, and a
// lane child stopped on an authentication failure while its token was fine.
const RESET_EPOCH = '1762400400'
const RESET_ISO = '2025-11-06T03:40:00.000Z'
const FORBIDDEN_STATUS = 403
const UNAUTHORIZED_STATUS = 401
const RATE_LIMIT_DETAIL = `gh: API rate limit exceeded for user ID 1. (HTTP 403)\n{"message":"API rate limit exceeded for user ID 1.","status":"403"}`
const AUTH_DETAIL = `gh: Bad credentials (HTTP 401)\n{"message":"Bad credentials","status":"401"}`

function fail_read(detail: string, status: number): void {
	classified_mock.mockResolvedValue({ kind: 'unreadable', reason: 'rejected', status, detail })
	comments_mock.mockResolvedValue(undefined)
}

describe('issue_read_cli.run — the cause of a failed read', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('reports an exhausted rate limit with its reset time', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(RESET_EPOCH)
		fail_read(RATE_LIMIT_DETAIL, FORBIDDEN_STATUS)

		expect(await issue_read_cli.run([ISSUE])).toBe(FAILURE)
		expect(reported()).toContain(gh_rate_limit.exhausted_message(new Date(RESET_ISO)))
	})

	it('reports a 401 with the authentication hint', async () => {
		fail_read(AUTH_DETAIL, UNAUTHORIZED_STATUS)

		expect(await issue_read_cli.run([ISSUE])).toBe(FAILURE)
		expect(reported()).toContain(gh_rate_limit.AUTH_HINT)
		expect(reported()).not.toContain('rate limit')
	})
})

// Long threads need individually readable parts so the shell output cap cannot hide comments
// (joshuafolkken/kit#3143).
describe('issue_read_cli.run — a thread past the Bash output cap', () => {
	const cap = bash_output_cap_reader.bash_output_cap(process.cwd())
	const long_body = 'a line of a long issue thread\n'.repeat(cap / LINE_FRACTION)
	const long_comments = JSON.stringify([
		{
			user: { login: 'someone' },
			author_association: TRUSTED,
			created_at: 'then',
			body: long_body,
		},
	])

	it('prints under the cap and loses none of the thread', async () => {
		classified_mock.mockResolvedValue(READ)
		comments_mock.mockResolvedValue(long_comments)

		expect(await issue_read_cli.run([ISSUE])).toBe(SUCCESS)
		expect(capped_print_fixture.largest_read(printed())).toBeLessThanOrEqual(cap)
		expect(capped_print_fixture.restored(printed())).toContain(long_body)
	})
})

describe('josh issue:read registration', () => {
	it('is registered as a josh command', () => {
		const source = readFileSync('scripts/josh/josh-commands-issue.ts', 'utf8')

		expect(source).toContain("'issue:read'")
		expect(source).toContain('scripts/issue/issue-read-main.ts')
	})
})
