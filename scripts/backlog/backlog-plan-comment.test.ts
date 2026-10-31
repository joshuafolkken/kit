import { tmpdir } from 'node:os'
import type { BusyRead } from '#scripts/epic/epic-busy'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { PLANNED_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import type { IssueComment } from '#scripts/issue/issue-read'
import { plan_consumers_section } from '#scripts/issue/plan-consumers-section'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_overlap } from './backlog-overlap'

const list_comments_mock = vi.hoisted(() => vi.fn())
const parse_comments_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_list_comments: list_comments_mock },
}))

vi.mock('#scripts/issue/issue-read', () => ({
	issue_read: { parse_comments: parse_comments_mock },
}))

const { backlog_plan_comment } = await import('./backlog-plan-comment')

// joshuafolkken/kit#4923: joshuafolkken/kit#4910's plan comment named files a running lane held, its
// body named none, so dispatch let it run and the lane waited in `lane:plan`.

const { REPO } = backlog_fixture
const RUNNING = 4911
const CANDIDATE = 4910
const SHARED = 'scripts/lane/lane-overrun-mechanisms-cli.ts'
const OLD_FILE = 'scripts/issue/issue-priority.ts'
const NO_DIRECTORY = tmpdir()
const RUNNING_BODY = `- \`${SHARED}\` を直す`
const CONSUMERS = `${plan_consumers_section.HEADING}\n\n- なし（新しい関数だけ）`

function changes(path: string): string {
	return `## 計画\n\n### 変更\n\n- \`${path}\`\n`
}

function plan(path: string): string {
	return `${changes(path)}\n${CONSUMERS}\n`
}

function comment(body: string, is_trusted: boolean | undefined = true): IssueComment {
	return { author: 'joshuafolkken', created_at: '2026-10-25T12:48:40Z', body, is_trusted }
}

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [RUN_LANE_LABEL], blocked_by: [] }
}

function busy(number: number): BusyRead {
	return {
		kind: 'busy',
		issues: [{ number, title: 'running', createdAt: '2026-10-25T00:00:00Z', blockedBy: undefined }],
	}
}

const PLANNED_CANDIDATE = {
	number: CANDIDATE,
	body: '本文にパスは無い',
	labels: [{ name: PLANNED_LABEL }],
}

beforeEach(() => {
	vi.clearAllMocks()
	list_comments_mock.mockResolvedValue('[]')
})

describe('backlog_plan_comment.plan_of', () => {
	it('takes the latest trusted comment carrying the consumers section', () => {
		const comments = [comment(plan(OLD_FILE)), comment('レビュー'), comment(plan(SHARED))]

		expect(backlog_plan_comment.plan_of(comments)).toBe(changes(SHARED))
	})

	it('skips a plan whose author is not trusted', () => {
		const comments = [comment(plan(OLD_FILE)), comment(plan(SHARED), false)]

		expect(backlog_plan_comment.plan_of(comments)).toBe(changes(OLD_FILE))
	})

	it('answers undefined when no comment is a plan', () => {
		expect(backlog_plan_comment.plan_of([comment('## 計画\n- 利用者の節が無い')])).toBeUndefined()
	})
})

describe('backlog_plan_comment.declared_of', () => {
	it('holds back a candidate whose plan comment names a file a running lane declares', async () => {
		parse_comments_mock.mockResolvedValue([comment(plan(SHARED))])
		const issues = [{ number: RUNNING, body: RUNNING_BODY }, PLANNED_CANDIDATE]
		const declared = await backlog_plan_comment.declared_of(issues, NO_DIRECTORY)
		const selection = backlog_overlap.separate(
			{ offered: [child(CANDIDATE)], withheld: [] },
			declared,
			{ read: busy(RUNNING), repo: REPO },
		)

		expect(selection.withheld.map((entry) => entry.number)).toStrictEqual([CANDIDATE])
		expect(list_comments_mock).toHaveBeenCalledExactlyOnceWith(String(CANDIDATE))
	})

	// joshuafolkken/kit#4937: joshuafolkken/kit#4929 waited on a path joshuafolkken/kit#4926's body only cited.
	it('declares only the plan of an issue whose body cites another path', async () => {
		parse_comments_mock.mockResolvedValue([comment(plan(OLD_FILE))])
		const issue = { ...PLANNED_CANDIDATE, body: RUNNING_BODY }
		const declared = await backlog_plan_comment.declared_of([issue], NO_DIRECTORY)

		expect(declared.get(CANDIDATE)).toStrictEqual(new Set([OLD_FILE]))
	})

	it('keeps the body when the plan comment names no path', async () => {
		parse_comments_mock.mockResolvedValue([comment(`## 計画\n\n散文だけ\n\n${CONSUMERS}\n`)])
		const issue = { ...PLANNED_CANDIDATE, body: RUNNING_BODY }
		const declared = await backlog_plan_comment.declared_of([issue], NO_DIRECTORY)

		expect(declared.get(CANDIDATE)).toStrictEqual(new Set([SHARED]))
	})
})

describe('backlog_plan_comment.declared_of without a plan', () => {
	it('reads no comments for an issue without run:planned', async () => {
		const declared = await backlog_plan_comment.declared_of(
			[{ number: CANDIDATE, body: RUNNING_BODY, labels: [] }],
			NO_DIRECTORY,
		)

		expect(declared.get(CANDIDATE)).toStrictEqual(new Set([SHARED]))
		expect(list_comments_mock).not.toHaveBeenCalled()
	})

	it('keeps the body alone when the comment listing could not be read', async () => {
		parse_comments_mock.mockResolvedValue(undefined)
		const issue = { ...PLANNED_CANDIDATE, body: RUNNING_BODY }
		const declared = await backlog_plan_comment.declared_of([issue], NO_DIRECTORY)

		expect(declared.get(CANDIDATE)).toStrictEqual(new Set([SHARED]))
	})
})

describe('backlog_plan_comment.plan_paths', () => {
	it('lists the paths the plan comment declares', async () => {
		parse_comments_mock.mockResolvedValue([comment(plan(SHARED))])

		expect(await backlog_plan_comment.plan_paths(CANDIDATE)).toStrictEqual([SHARED])
	})

	it('leaves out a file the consumers section names only as a reader', async () => {
		const reader = `${plan_consumers_section.HEADING}\n\n- \`${OLD_FILE}\` が読む → 変更なし`

		parse_comments_mock.mockResolvedValue([comment(`${changes(SHARED)}\n${reader}\n`)])

		expect(await backlog_plan_comment.plan_paths(CANDIDATE)).toStrictEqual([SHARED])
	})

	it('answers none when the issue has no plan comment', async () => {
		parse_comments_mock.mockResolvedValue([])

		expect(await backlog_plan_comment.plan_paths(CANDIDATE)).toStrictEqual([])
	})
})
