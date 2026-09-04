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
const OTHER_ISSUE = '1302'
const CLOSED_JSON = '{"state":"CLOSED","labels":[{"name":"in-progress"}]}'
const OPEN_JSON = '{"state":"OPEN","labels":[]}'
const REPO = 'owner/repo'
const READ_CLOSED = { kind: 'read', json: CLOSED_JSON }
const READ_OPEN = { kind: 'read', json: OPEN_JSON }
// The one-number report, spelled out rather than composed from the formatter: this is the shape
// `.claude/skills/workflow-commands/SKILL.md` §2z and `.claude/skills/diag/SKILL.md` read verbatim,
// so a test that built it the same way the code does would agree with any change to either.
const SINGLE_REPORT = 'state: CLOSED\nlabels: in-progress\nhuman_review: no'

beforeEach(() => {
	classified_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
	info_mock.mockReset()
	error_mock.mockReset()
})

describe('issue_state_cli.parse_request', () => {
	it('reads the issue number from a bare argument', () => {
		expect(issue_state_cli.parse_request([ISSUE])).toEqual({ issue_numbers: [ISSUE] })
	})

	it('reads the repository a cross-repository child lives in', () => {
		expect(issue_state_cli.parse_request([ISSUE, '--repo', REPO])).toEqual({
			issue_numbers: [ISSUE],
			repo: REPO,
		})
	})

	// joshuafolkken/kit#1302: the order they were typed in is the order the report prints them in,
	// which is the order the caller wrote its own table in.
	it('keeps every number given, in the order they were typed', () => {
		expect(issue_state_cli.parse_request([OTHER_ISSUE, ISSUE])).toEqual({
			issue_numbers: [OTHER_ISSUE, ISSUE],
		})
	})

	// A dropped token answers fewer numbers than were asked for and still exits zero, and with one
	// number left the surviving block prints in the single-number shape — so nothing in the output
	// says a number went unanswered. `#1262` copied out of a `diag` table is exactly that token.
	it('refuses the whole call when a token is not an issue number', () => {
		expect(issue_state_cli.parse_request([`#${ISSUE}`, OTHER_ISSUE])).toBeUndefined()
	})

	it('reads a repeated number once', () => {
		expect(issue_state_cli.parse_request([ISSUE, OTHER_ISSUE, ISSUE])).toEqual({
			issue_numbers: [ISSUE, OTHER_ISSUE],
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

// Answers each number with a read of its own, so a test about attribution cannot pass on the order
// the blocks happen to come out in.
function answer_closed_then_open(): void {
	classified_mock.mockImplementation(async (issue_number: string) =>
		issue_number === ISSUE ? READ_CLOSED : READ_OPEN,
	)
}

// joshuafolkken/kit#1302: several numbers in one call. A `diag` table reads a state per row, and one
// process start plus one round trip per row is what made five rows cost about eight seconds.
describe('issue_state_cli.run — several numbers in one call', () => {
	// The load-bearing half: §2z's `needs-human-review` stop and the `diag` skill both read the three
	// lines of a one-number report verbatim, so the batch may not add a fourth line to that case.
	it('prints a one-number report exactly as it did before', async () => {
		classified_mock.mockResolvedValue(READ_CLOSED)

		expect(await issue_state_cli.run([ISSUE])).toBe(SUCCESS)
		expect(info_mock).toHaveBeenCalledWith(SINGLE_REPORT)
	})

	it('attributes each block to its own number', async () => {
		answer_closed_then_open()

		expect(await issue_state_cli.run([ISSUE, OTHER_ISSUE])).toBe(SUCCESS)
		expect(info_mock).toHaveBeenCalledWith(
			expect.stringContaining(`issue: ${ISSUE}\nstate: CLOSED`),
		)
		expect(info_mock).toHaveBeenCalledWith(
			expect.stringContaining(`issue: ${OTHER_ISSUE}\nstate: OPEN`),
		)
	})

	it('reports every number from one process, in one printed report', async () => {
		answer_closed_then_open()

		await issue_state_cli.run([ISSUE, OTHER_ISSUE])

		expect(classified_mock).toHaveBeenCalledTimes(2)
		expect(info_mock).toHaveBeenCalledTimes(1)
	})

	it('passes the named repository through for every number', async () => {
		classified_mock.mockResolvedValue(READ_CLOSED)

		await issue_state_cli.run([ISSUE, OTHER_ISSUE, '--repo', REPO])

		expect(classified_mock).toHaveBeenCalledWith(ISSUE, issue_state_cli.STATE_FIELDS, REPO)
		expect(classified_mock).toHaveBeenCalledWith(OTHER_ISSUE, issue_state_cli.STATE_FIELDS, REPO)
	})
})

// A `diag` table mixes closed issues, open ones and numbers quoted from prose that resolve to
// nothing. A batch that gave up on the whole call for one of those would answer nothing at all.
describe('issue_state_cli.run — a number that produced no state among several', () => {
	it('keeps the other numbers when one does not resolve', async () => {
		classified_mock.mockImplementation(async (issue_number: string) =>
			issue_number === ISSUE ? { kind: 'missing' } : READ_OPEN,
		)

		expect(await issue_state_cli.run([ISSUE, OTHER_ISSUE])).toBe(FAILURE)
		expect(info_mock).toHaveBeenCalledWith(expect.stringContaining(`issue: ${OTHER_ISSUE}`))
		expect(error_mock).toHaveBeenCalledWith(expect.stringContaining(`#${ISSUE} does not resolve`))
	})

	// The two failure kinds stay apart in a batch: a gap is retried, an answer about the number is not.
	it('keeps a failed read apart from a number that resolves to nothing', async () => {
		classified_mock.mockImplementation(async (issue_number: string) =>
			issue_number === ISSUE ? { kind: 'unreadable' } : READ_OPEN,
		)

		expect(await issue_state_cli.run([ISSUE, OTHER_ISSUE])).toBe(FAILURE)
		expect(error_mock).toHaveBeenCalledWith(
			expect.stringContaining(`could not read issue #${ISSUE}`),
		)
	})
})

// gh accepts both spellings, and the inline one reaching the separate-word branch would read as no
// repository at all — the same fall back to the session's repository the flag exists to prevent.
describe('issue_state_cli.parse_request — the inline --repo=<owner/repo> spelling', () => {
	it('reads the repository from a single token', () => {
		expect(issue_state_cli.parse_request([ISSUE, `--repo=${REPO}`])).toEqual({
			issue_numbers: [ISSUE],
			repo: REPO,
		})
	})

	it('refuses an inline flag with an empty value', () => {
		expect(issue_state_cli.parse_request([ISSUE, '--repo='])).toBeUndefined()
	})
})
