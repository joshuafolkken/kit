import { auto_ok_fixture } from '#scripts/auto-ok/auto-ok-fixture'
import { listing_outcome } from '#scripts/git/git-gh-issue-list-fixture'
import { IN_PROGRESS_LABEL } from '#scripts/git/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EpicSnapshot } from './epic-fetch'
import type { EpicChild } from './epic-graph'
import { epic_next } from './epic-next'

// joshuafolkken/kit#1121: `read_blocked_by` answers from the issue's own dependency summary when that
// summary says zero, so a child whose counter is stale reads as having no blockers at all. Nothing in
// the epic body marks such a child as a suspect when the relation was never declared there, so
// joshuafolkken/kit#1113's re-read cannot reach it — and the mistake runs the dangerous way: the
// child is classified runnable and handed to an unattended run that then implements it before its
// prerequisite. `epic:next --repo` therefore confirms the one candidate it is about to offer against
// the relations listing itself.

vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: {
		issue_list_by_label_in_repo: vi.fn(),
		issue_blocked_by_numbers: vi.fn(),
	},
}))

const { git_gh_command } = await import('#scripts/git/git-gh-command')
const issue_list = vi.mocked(git_gh_command.issue_list_by_label_in_repo)
const blocked_by = vi.mocked(git_gh_command.issue_blocked_by_numbers)

const { record } = auto_ok_fixture

const REPO = 'joshuafolkken/kit'
const BLOCKER = 861
const BLOCKED = 862
const SIBLING = 863
const SUCCESS_EXIT_CODE = 0
const WAIT_TOKEN = 'wait'

function child(number: number, labels: ReadonlyArray<string> = []): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels, blocked_by: [] }
}

function snapshot(children: ReadonlyArray<EpicChild>): EpicSnapshot {
	return {
		body: undefined,
		current_repo: REPO,
		children,
		child_numbers: children.map((entry) => entry.number),
		unreadable: [],
		skipped: [],
		has_external_children: false,
	}
}

const stdout_lines: Array<string> = []
const stderr_lines: Array<string> = []

vi.spyOn(console, 'info').mockImplementation(record(stdout_lines))
vi.spyOn(console, 'error').mockImplementation(record(stderr_lines))

function stdout(): string {
	return stdout_lines.join('\n')
}

// One `--repo` answer, end to end: classify the children, ask the repository whether anything is
// running there, then confirm the candidate against its relations listing.
async function answer_for(children: ReadonlyArray<EpicChild>): Promise<number> {
	const state = snapshot(children)

	return await epic_next.report(epic_next.decide(state), state, REPO)
}

beforeEach(() => {
	vi.clearAllMocks()
	stdout_lines.length = 0
	stderr_lines.length = 0
	issue_list.mockResolvedValue(listing_outcome('[]'))
	blocked_by.mockResolvedValue([])
})

describe('josh epic:next --repo — confirming the candidate', () => {
	it('offers the child when the listing agrees with its summary', async () => {
		expect(await answer_for([child(BLOCKER)])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(BLOCKER))
	})

	// The defect itself: the summary counted zero, the listing names an open blocker, and the child
	// would otherwise have been handed to an unattended run ahead of its prerequisite.
	it('withholds a child whose listing names a blocker the summary did not count', async () => {
		blocked_by.mockResolvedValue([BLOCKER])

		expect(await answer_for([child(BLOCKER, [IN_PROGRESS_LABEL]), child(BLOCKED)])).toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(stdout()).toBe(WAIT_TOKEN)
	})

	it('names the relation that withheld the candidate rather than only answering wait', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		blocked_by.mockResolvedValue([BLOCKER])
		await answer_for([child(BLOCKER, [IN_PROGRESS_LABEL]), child(BLOCKED)])

		expect(warn.mock.calls.join('\n')).toContain(`#${String(BLOCKER)}`)
		expect(warn.mock.calls.join('\n')).toContain('did not count')
		warn.mockRestore()
	})

	// The recorded decision on joshuafolkken/kit#1108: a healthy sibling is not made to wait for one
	// child whose counter is stale, because nobody repairs that counter and the wait would not clear.
	it('offers the sibling behind a candidate it withheld', async () => {
		blocked_by.mockImplementation(async (issue_number: string) =>
			issue_number === String(BLOCKED) ? [BLOCKER] : [],
		)

		await answer_for([child(BLOCKER, [IN_PROGRESS_LABEL]), child(BLOCKED), child(SIBLING)])

		expect(stdout()).toBe(String(SIBLING))
	})
})

describe('josh epic:next --repo — the cost of confirming', () => {
	it('reads the listing once for the candidate it offers', async () => {
		await answer_for([child(BLOCKER), child(BLOCKED)])

		expect(blocked_by).toHaveBeenCalledTimes(1)
	})

	// The confirmation is taken after the exclusion, so a repository that is already running something
	// is handed nothing and pays nothing for it — an `epicrun` polls this every sixty seconds.
	it('reads nothing while the repository is busy', async () => {
		issue_list.mockResolvedValue(
			listing_outcome(JSON.stringify([{ number: 700, labels: [{ name: IN_PROGRESS_LABEL }] }])),
		)

		expect(await answer_for([child(BLOCKER)])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(WAIT_TOKEN)
		expect(blocked_by).not.toHaveBeenCalled()
	})
})
