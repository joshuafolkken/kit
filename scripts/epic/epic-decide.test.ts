import { git_gh_command } from '#scripts/gh/git-gh-command'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_decide } from './epic-decide'
import { epic_decision } from './epic-decision'

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_get_labels_and_body: vi.fn(),
		issue_edit_body: vi.fn(),
		issue_list_comments: vi.fn(),
		issue_try_comment: vi.fn(),
		issue_clear_label: vi.fn(),
	},
}))

// `epic --decide` writes three things — the epic's `## Decisions` entry, a comment on each child, and
// each child's `needs-decision` removal — and a rerun after a partial failure must write none of them
// twice.

const EPIC_NUMBER = 893
const CHILD = 894
const UNTRACKED = 899
const BLANK = ''
const RECORD = ['### Hold #894 until the API lands', BLANK, '- 理由: 上流の変更待ち'].join('\n')
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const EPIC_BODY = ['## Progress', BLANK, '- [ ] #890', '- [ ] #894', BLANK].join('\n')

const mocked_read = vi.mocked(git_gh_command.issue_get_labels_and_body)
const mocked_edit = vi.mocked(git_gh_command.issue_edit_body)
const mocked_comments = vi.mocked(git_gh_command.issue_list_comments)
const mocked_comment = vi.mocked(git_gh_command.issue_try_comment)
const mocked_clear = vi.mocked(git_gh_command.issue_clear_label)

function epic_json(body: string): string {
	return JSON.stringify({ number: EPIC_NUMBER, labels: [{ name: 'epic' }], body })
}

function comments_json(bodies: ReadonlyArray<string>): string {
	return JSON.stringify(
		bodies.map((body) => ({ user: { login: 'joshuafolkken' }, author_association: 'OWNER', body })),
	)
}

async function decide(children: ReadonlyArray<number> = [CHILD]): Promise<number> {
	return await epic_decide.decide({ epic_number: EPIC_NUMBER, children, decision: RECORD })
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	mocked_read.mockResolvedValue(epic_json(EPIC_BODY))
	mocked_edit.mockResolvedValue('')
	mocked_comments.mockResolvedValue(comments_json([]))
	mocked_comment.mockResolvedValue(true)
	mocked_clear.mockResolvedValue(true)
})

describe('epic_decide.decide — first run', () => {
	it('records the entry, comments on the child and removes needs-decision', async () => {
		const result = await decide()

		expect(result).toBe(SUCCESS_EXIT_CODE)
		expect(mocked_edit).toHaveBeenCalledWith(
			String(EPIC_NUMBER),
			epic_decision.append_decision(EPIC_BODY, RECORD),
		)
		expect(mocked_comment).toHaveBeenCalledWith(String(CHILD), RECORD)
		expect(mocked_clear).toHaveBeenCalledWith(String(CHILD), NEEDS_DECISION_LABEL)
	})

	it('keeps the label when the comment is refused, and exits 1', async () => {
		mocked_comment.mockResolvedValue(false)

		expect(await decide()).toBe(FAILURE_EXIT_CODE)
		expect(mocked_clear).not.toHaveBeenCalled()
	})

	it('posts nothing when the child comments cannot be read', async () => {
		mocked_comments.mockResolvedValue(undefined)

		expect(await decide()).toBe(FAILURE_EXIT_CODE)
		expect(mocked_comment).not.toHaveBeenCalled()
		expect(mocked_clear).not.toHaveBeenCalled()
	})
})

describe('epic_decide.decide — rerun', () => {
	it('writes neither the entry nor the comment a second time', async () => {
		mocked_read.mockResolvedValue(epic_json(epic_decision.append_decision(EPIC_BODY, RECORD)))
		mocked_comments.mockResolvedValue(comments_json([RECORD]))

		expect(await decide()).toBe(SUCCESS_EXIT_CODE)
		expect(mocked_edit).not.toHaveBeenCalled()
		expect(mocked_comment).not.toHaveBeenCalled()
		expect(mocked_clear).toHaveBeenCalledWith(String(CHILD), NEEDS_DECISION_LABEL)
	})
})

// joshuafolkken/kit#5758: a decision that widens a child's scope restates its body estimate, so
// `lane:plan` does not read the estimate filed before the decision.
const OLD_SIZE = '- 規模見積もり: 約 2 ファイル / 60 行（テスト除く）'
const NEW_SIZE = '- 規模見積もり: 約 11 ファイル / 300 行（テスト除く）'

function child_body(size: string): string {
	return ['## 背景', BLANK, size, BLANK, '## 現象'].join('\n')
}

function read_child(size: string): void {
	mocked_read.mockImplementation(async (issue_number) => {
		await Promise.resolve()
		if (issue_number !== String(CHILD)) return epic_json(EPIC_BODY)

		return JSON.stringify({ number: CHILD, labels: [], body: child_body(size) })
	})
}

async function decide_widening(): Promise<number> {
	return await epic_decide.decide({
		epic_number: EPIC_NUMBER,
		children: [CHILD],
		decision: `${RECORD}\n${NEW_SIZE}`,
	})
}

describe('epic_decide.decide — size estimate', () => {
	it('replaces the child body estimate with the one the record states', async () => {
		read_child(OLD_SIZE)

		expect(await decide_widening()).toBe(SUCCESS_EXIT_CODE)
		expect(mocked_edit).toHaveBeenCalledWith(String(CHILD), child_body(NEW_SIZE))
		expect(mocked_clear).toHaveBeenCalledWith(String(CHILD), NEEDS_DECISION_LABEL)
	})

	it('does not rewrite a child that already declares the stated estimate', async () => {
		read_child(NEW_SIZE)

		expect(await decide_widening()).toBe(SUCCESS_EXIT_CODE)
		expect(mocked_edit).not.toHaveBeenCalledWith(String(CHILD), expect.anything())
	})

	it('keeps needs-decision when the child cannot be read', async () => {
		mocked_read.mockImplementation(async (issue_number) => {
			await Promise.resolve()

			return issue_number === String(CHILD) ? undefined : epic_json(EPIC_BODY)
		})

		expect(await decide_widening()).toBe(FAILURE_EXIT_CODE)
		expect(mocked_clear).not.toHaveBeenCalled()
	})

	it('reads no child body when the record states no estimate', async () => {
		expect(await decide()).toBe(SUCCESS_EXIT_CODE)
		expect(mocked_read).not.toHaveBeenCalledWith(String(CHILD))
	})
})

describe('epic_decide.decide — refused before any write', () => {
	it('refuses a child the epic does not track', async () => {
		expect(await decide([CHILD, UNTRACKED])).toBe(FAILURE_EXIT_CODE)
		expect(mocked_edit).not.toHaveBeenCalled()
		expect(mocked_comment).not.toHaveBeenCalled()
		expect(mocked_clear).not.toHaveBeenCalled()
	})

	it('refuses an unreadable epic', async () => {
		mocked_read.mockResolvedValue(undefined)

		expect(await decide()).toBe(FAILURE_EXIT_CODE)
		expect(mocked_edit).not.toHaveBeenCalled()
	})

	it('refuses an empty record without reading the epic', async () => {
		const result = await epic_decide.decide({
			epic_number: EPIC_NUMBER,
			children: [CHILD],
			decision: '',
		})

		expect(result).toBe(FAILURE_EXIT_CODE)
		expect(mocked_read).not.toHaveBeenCalled()
	})
})
