import { beforeEach, describe, expect, it, vi } from 'vitest'

const classified_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const error_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: { issue_view_json_classified: classified_mock },
}))

const { issue_state_cli } = await import('./issue-state-cli')

const SUCCESS = 0
const FAILURE = 1
const ISSUE = '1054'
const CLOSED_JSON = '{"state":"CLOSED","labels":[{"name":"in-progress"}]}'
const REPO = 'owner/repo'
const READ_CLOSED = { kind: 'read', json: CLOSED_JSON }

beforeEach(() => {
	classified_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
	info_mock.mockReset()
	error_mock.mockReset()
})

describe('issue_state_cli.parse_request', () => {
	it('reads the issue number from a bare argument', () => {
		expect(issue_state_cli.parse_request([ISSUE])).toEqual({ issue_number: ISSUE })
	})

	it('reads the repository a cross-repository child lives in', () => {
		expect(issue_state_cli.parse_request([ISSUE, '--repo', REPO])).toEqual({
			issue_number: ISSUE,
			repo: REPO,
		})
	})

	it('rejects an invocation with no issue number', () => {
		expect(issue_state_cli.parse_request(['--repo', REPO])).toBeUndefined()
	})
})

describe('issue_state_cli.run — a state that was read', () => {
	it('prints the state and exits zero', async () => {
		classified_mock.mockResolvedValue(READ_CLOSED)

		expect(await issue_state_cli.run([ISSUE])).toBe(SUCCESS)
		expect(info_mock).toHaveBeenCalledWith(expect.stringContaining('state: CLOSED'))
	})

	// The two reads the documents used to prescribe asked for `state` and for `state,labels`; one
	// call answers both, and the field names stay the ones `gh issue view --json` gave them so the
	// REST casing never reaches this file.
	it('asks for the state and the labels in one read', async () => {
		classified_mock.mockResolvedValue(READ_CLOSED)

		await issue_state_cli.run([ISSUE])

		expect(classified_mock).toHaveBeenCalledWith(ISSUE, issue_state_cli.STATE_FIELDS, undefined)
	})

	it('passes the named repository through to the read', async () => {
		classified_mock.mockResolvedValue(READ_CLOSED)

		await issue_state_cli.run([ISSUE, '--repo', REPO])

		expect(classified_mock).toHaveBeenCalledWith(ISSUE, issue_state_cli.STATE_FIELDS, REPO)
	})
})

// joshuafolkken/kit#1054: `gh issue view` exited non-zero with an empty stdout for a rate limit and
// for a number that does not exist alike. A loop reading that as "not CLOSED" reports a child as
// failed because nobody could reach GitHub, so neither case may print as a state.
describe('issue_state_cli.run — a read that produced no state', () => {
	it('reports a number that resolves to nothing as an answer about the number', async () => {
		classified_mock.mockResolvedValue({ kind: 'missing' })

		expect(await issue_state_cli.run([ISSUE])).toBe(FAILURE)
		expect(error_mock).toHaveBeenCalledWith(expect.stringContaining('does not resolve'))
	})

	it('says explicitly that an unreadable issue is not an open one', async () => {
		classified_mock.mockResolvedValue({ kind: 'unreadable' })

		expect(await issue_state_cli.run([ISSUE])).toBe(FAILURE)
		expect(error_mock).toHaveBeenCalledWith(expect.stringContaining('is not "the issue is open"'))
	})

	it('does not print a state when the response is not an issue', async () => {
		classified_mock.mockResolvedValue({ kind: 'read', json: '{"message":"Not Found"}' })

		expect(await issue_state_cli.run([ISSUE])).toBe(FAILURE)
		expect(info_mock).not.toHaveBeenCalled()
	})

	it('prints the usage when no issue number was given', async () => {
		expect(await issue_state_cli.run([])).toBe(FAILURE)
		expect(error_mock).toHaveBeenCalledWith(issue_state_cli.USAGE)
		expect(classified_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#1054: falling back to the session's repository for a `--repo` with nothing after
// it would print a confident state for a different issue of the same number — the exact misread the
// argument exists to prevent.
describe('issue_state_cli.parse_request — a repository named but not given', () => {
	it('refuses a trailing --repo with no value', () => {
		expect(issue_state_cli.parse_request([ISSUE, '--repo'])).toBeUndefined()
	})

	it('refuses a --repo followed by another flag', () => {
		expect(issue_state_cli.parse_request([ISSUE, '--repo', '--json'])).toBeUndefined()
	})
})

// gh accepts both spellings, and the inline one reaching the separate-word branch would read as no
// repository at all — the same fall back to the session's repository the flag exists to prevent.
describe('issue_state_cli.parse_request — the inline --repo=<owner/repo> spelling', () => {
	it('reads the repository from a single token', () => {
		expect(issue_state_cli.parse_request([ISSUE, `--repo=${REPO}`])).toEqual({
			issue_number: ISSUE,
			repo: REPO,
		})
	})

	it('refuses an inline flag with an empty value', () => {
		expect(issue_state_cli.parse_request([ISSUE, '--repo='])).toBeUndefined()
	})
})
