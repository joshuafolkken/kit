import { epic_fetch } from '#scripts/epic/epic-fetch'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_epic_add } from './git-epic-add'
import { EPIC_FIXTURE_REPO, git_epic_add_fixture } from './git-epic-add-fixture'
import { UNORDERED_DEPENDENCIES } from './git-epic-parse'
import { git_gh_command } from './git-gh-command'

vi.mock('#scripts/epic/epic-fetch', () => ({
	epic_fetch: { fetch_children: vi.fn() },
}))

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		issue_get_labels_and_body: vi.fn(),
		repo_get_name_with_owner: vi.fn(),
		issue_edit_body: vi.fn(),
		issue_comment: vi.fn(),
		issue_try_comment: vi.fn(),
		issue_add_blocked_by: vi.fn(),
		issue_remove_blocked_by: vi.fn(),
	},
}))

// The wiring layer between the plan (asserted without a network in `git-epic-add-plan.test.ts`) and the
// writes (asserted in `git-gh-issue-write.test.ts`). What only this layer can say is the **order**: the
// epic's body carries the decision record before any child is told about it, and a refused comment
// still leaves the insertion successful (joshuafolkken/kit#1350).

const { child } = git_epic_add_fixture
const REPO = EPIC_FIXTURE_REPO
const EPIC_NUMBER = 893
const DEPENDENCIES_HEADING = '## Dependencies'
const PROGRESS_HEADING = '## Progress'
const ROW_890 = '- [ ] #890'
const CHILD = 894
const BLANK = ''
const RECORD = ['### Where #894 goes', BLANK, '- 理由: 主題が同じ'].join('\n')
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

const EPIC_BODY = [
	DEPENDENCIES_HEADING,
	BLANK,
	UNORDERED_DEPENDENCIES,
	BLANK,
	PROGRESS_HEADING,
	BLANK,
	ROW_890,
	BLANK,
].join('\n')

const mocked_read = vi.mocked(git_gh_command.issue_get_labels_and_body)
const mocked_repo = vi.mocked(git_gh_command.repo_get_name_with_owner)
const mocked_edit = vi.mocked(git_gh_command.issue_edit_body)
const mocked_comment = vi.mocked(git_gh_command.issue_try_comment)
const mocked_fetch = vi.mocked(epic_fetch.fetch_children)

// The calls both writers made, in the order they were made, so "the body first" is an assertion about
// the sequence rather than about two independent spies.
const order: Array<string> = []

beforeEach(() => {
	vi.clearAllMocks()
	order.length = 0
	mocked_read.mockResolvedValue(
		JSON.stringify({ number: EPIC_NUMBER, labels: [{ name: 'epic' }], body: EPIC_BODY }),
	)
	mocked_repo.mockResolvedValue(REPO)
	mocked_fetch.mockResolvedValue({
		children: [child(890)],
		unreadable: [],
		skipped: [],
		unreachable_count: 0,
	})
	mocked_edit.mockImplementation(async () => {
		order.push('body')

		return 'url'
	})
	mocked_comment.mockImplementation(async () => {
		order.push('comment')

		return true
	})
})

async function add(decision?: string): Promise<number> {
	return await git_epic_add.add_children({
		epic_number: EPIC_NUMBER,
		children: [CHILD],
		decision,
	})
}

describe('git_epic_add.add_children — without a decision record', () => {
	it('edits the epic body and posts no comment', async () => {
		expect(await add()).toBe(SUCCESS_EXIT_CODE)
		expect(order).toStrictEqual(['body'])
	})
})

describe('git_epic_add.add_children — with a decision record', () => {
	it('writes the record into the epic body before commenting on the child', async () => {
		expect(await add(RECORD)).toBe(SUCCESS_EXIT_CODE)
		expect(order).toStrictEqual(['body', 'comment'])
		expect(mocked_edit.mock.calls[0]?.[1]).toContain('## Decisions')
	})

	it('comments only on the children it added', async () => {
		await add(RECORD)

		expect(mocked_comment.mock.calls).toStrictEqual([[String(CHILD), RECORD]])
	})

	// The insertion has landed by the time the comments go out, so a refused one is counted rather than
	// turned into a failure the caller would read as "nothing was written".
	it('still succeeds when a comment cannot be posted', async () => {
		mocked_comment.mockResolvedValue(false)

		expect(await add(RECORD)).toBe(SUCCESS_EXIT_CODE)
	})

	// Every refusal happens before the body edit, so a rejected record leaves the epic untouched — and
	// leaves no comment behind either.
	it('writes nothing at all when the record is refused', async () => {
		expect(await add(' '.repeat(3))).toBe(FAILURE_EXIT_CODE)
		expect(order).toStrictEqual([])
	})
})

// A move writes no new task-list row, so the `📋 Added …` line would name an empty list. The two
// edits are reported separately, and neither line is printed unconditionally (joshuafolkken/kit#1701).
const PAIR_BODY = [
	DEPENDENCIES_HEADING,
	BLANK,
	UNORDERED_DEPENDENCIES,
	BLANK,
	PROGRESS_HEADING,
	BLANK,
	ROW_890,
	'- [ ] #891',
	BLANK,
].join('\n')

function stub_pair_epic(): void {
	mocked_read.mockResolvedValue(
		JSON.stringify({ number: EPIC_NUMBER, labels: [{ name: 'epic' }], body: PAIR_BODY }),
	)
	mocked_fetch.mockResolvedValue({
		children: [child(890), child(891)],
		unreadable: [],
		skipped: [],
		unreachable_count: 0,
	})
}

async function move_891_after_890(): Promise<number> {
	return await git_epic_add.add_children({
		epic_number: EPIC_NUMBER,
		children: [891],
		position: { kind: 'after', target: 890 },
	})
}

describe('git_epic_add.add_children — a child the epic already tracks', () => {
	it('reports the move and prints no addition line', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		stub_pair_epic()

		expect(await move_891_after_890()).toBe(SUCCESS_EXIT_CODE)

		const lines = info.mock.calls.map((call) => String(call[0]))

		info.mockRestore()
		expect(lines).toContain(`📋 Moved #891 within epic #${String(EPIC_NUMBER)}.`)
		expect(lines.some((line) => line.startsWith('📋 Added'))).toBe(false)
	})

	it('still edits the epic body', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		stub_pair_epic()

		expect(await move_891_after_890()).toBe(SUCCESS_EXIT_CODE)
		expect(mocked_edit.mock.calls[0]?.[1]).toContain('#890 -> #891')
	})
})
