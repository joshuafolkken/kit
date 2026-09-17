import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_read } from './issue-read'

const classified_mock = vi.hoisted(() => vi.fn())
const comments_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const error_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: {
		issue_view_json_classified: classified_mock,
		issue_list_comments: comments_mock,
	},
}))

const { issue_read_cli } = await import('./issue-read-cli')

// `josh issue:read` — the command that collapses the two `gh api` reads §2g requires per issue into
// one call (joshuafolkken/kit#1715).
//
// The cases are about what the batch must not lose: a number that resolves to nothing is named rather
// than silently missing from the output, and a comment listing that failed is reported as failed
// rather than as an issue with no comments.

const SUCCESS = 0
const FAILURE = 1
const ISSUE = '1715'
const OTHER_ISSUE = '1567'
const FIELDS_JSON = JSON.stringify({ title: 'A title', state: 'open', body: 'The body' })
const READ = { kind: 'read', json: FIELDS_JSON }
const COMMENTS_JSON = JSON.stringify([
	{ user: { login: 'someone' }, created_at: 'then', body: 'A comment' },
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
	// already have overturned — the misread §2g exists to prevent.
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
})

describe('josh issue:read registration', () => {
	it('is registered as a josh command', () => {
		const source = readFileSync('scripts/josh/josh-commands-ai.ts', 'utf8')

		expect(source).toContain("'issue:read'")
		expect(source).toContain('scripts/issue/issue-read-cli.ts')
	})
})
