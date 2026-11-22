import { tmpdir } from 'node:os'
import type { BusyRead } from '#scripts/epic/epic-busy'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { working_tree } from '#scripts/init/working-tree'
import { PLANNED_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import type { IssueComment } from '#scripts/issue/issue-read'
import { plan_consumers_section } from '#scripts/issue/plan-consumers-section'
import { lane_plan } from '#scripts/lane/lane-plan'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_overlap } from './backlog-overlap'
import type { PoolIssue } from './backlog-plan-comment'
import { plan_definitions_fixture } from './plan-definitions-fixture'

const list_comments_mock = vi.hoisted(() => vi.fn())
const parse_comments_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_list_comments: list_comments_mock },
}))

vi.mock('#scripts/issue/issue-read', () => ({
	issue_read: { parse_comments: parse_comments_mock },
}))

const { backlog_plan_comment } = await import('./backlog-plan-comment')
const { backlog_rank } = await import('./backlog-rank')

// joshuafolkken/kit#4923: joshuafolkken/kit#4910's plan comment named files a running lane held, its
// body named none, so dispatch let it run and the lane waited in `lane:plan`.

const { REPO } = backlog_fixture
const RUNNING = 4911
const CANDIDATE = 4910
const SHARED = 'scripts/lane/lane-overrun-mechanisms-cli.ts'
const OLD_FILE = 'scripts/issue/issue-priority.ts'
const NO_DIRECTORY = tmpdir()
const RUNNING_BODY = `- \`${SHARED}\` を直す`
const COMMENTED_AT = '2026-10-25T12:48:40Z'
const CONSUMERS = `${plan_consumers_section.HEADING}\n\n- なし（新しい関数だけ）`

function changes(path: string): string {
	return `## 計画\n\n### 変更\n\n- \`${path}\`\n`
}

function plan(path: string): string {
	return `${changes(path)}\n${CONSUMERS}\n`
}

function comment(body: string, is_trusted: boolean | undefined = true): IssueComment {
	return { author: 'joshuafolkken', created_at: COMMENTED_AT, body, is_trusted }
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

	// joshuafolkken/kit#6798: a recorded plan yields to a plan comment posted after it.
	it('hands the lane plans the time its plan comment was posted', async () => {
		const with_plans = vi.spyOn(lane_plan, 'with_plans')

		parse_comments_mock.mockResolvedValue([comment(plan(SHARED))])
		await backlog_plan_comment.declared_of([PLANNED_CANDIDATE], NO_DIRECTORY)

		expect(with_plans.mock.calls[0]?.[2]).toStrictEqual(new Map([[CANDIDATE, COMMENTED_AT]]))
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

// joshuafolkken/kit#8273: a bare file name meets the full path a running lane plans.
describe('backlog_plan_comment.declared_of — a bare file name', () => {
	it("resolves a body's bare file name against the directory's tracked files", async () => {
		const listing = vi.spyOn(working_tree, 'listing').mockReturnValue([SHARED, OLD_FILE])
		const issue = { number: CANDIDATE, body: '`lane-overrun-mechanisms-cli.ts` を直す', labels: [] }
		const declared = await backlog_plan_comment.declared_of([issue], NO_DIRECTORY)

		expect(declared.get(CANDIDATE)).toStrictEqual(new Set([SHARED]))
		expect(listing).toHaveBeenCalledExactlyOnceWith(['ls-files'], NO_DIRECTORY)
	})
})

// joshuafolkken/kit#8685: joshuafolkken/kit#8676's plan named `ThemeDefinition` but not the file
// defining it, which its body named, and it launched beside joshuafolkken/kit#8673, which planned it.
const { PANEL_DRAW, THEME_BODY, THEME_DEFS } = plan_definitions_fixture
const CLOCKS_ISSUE = 8673
const THEME_ISSUE = 8676
const THEME_PLAN = `${plan_definitions_fixture.THEME_PLAN}\n${CONSUMERS}\n`
const IDLE: BusyRead = { kind: 'busy', issues: [] }
const make_directory = temporary_directory()

function board_repo(): string {
	return plan_definitions_fixture.board_repo(make_directory('plan-definitions-'))
}

function planned(number: number, body: string): PoolIssue {
	return { number, body, labels: [{ name: PLANNED_LABEL }] }
}

function plans_by_issue(plans: ReadonlyMap<number, string>): void {
	list_comments_mock.mockImplementation(async (issue: string) => await issue)
	parse_comments_mock.mockImplementation(async (issue: string) => [
		comment(plans.get(Number(issue)) ?? ''),
	])
}

describe('backlog_plan_comment.declared_of — a name the plan defines in a body file', () => {
	it('keeps the body file defining a name the plan carries, and no other body file', async () => {
		plans_by_issue(new Map([[THEME_ISSUE, THEME_PLAN]]))
		const issues = [planned(THEME_ISSUE, THEME_BODY)]
		const declared = await backlog_plan_comment.declared_of(issues, board_repo())

		expect(declared.get(THEME_ISSUE)).toStrictEqual(new Set([PANEL_DRAW, THEME_DEFS]))
	})

	it('holds the later of two issues back when one plans the file the other plans by a name', async () => {
		plans_by_issue(
			new Map([
				[CLOCKS_ISSUE, plan(THEME_DEFS)],
				[THEME_ISSUE, THEME_PLAN],
			]),
		)
		const issues = [planned(CLOCKS_ISSUE, THEME_BODY), planned(THEME_ISSUE, THEME_BODY)]
		const declared = await backlog_plan_comment.declared_of(issues, board_repo())
		const candidates = [child(CLOCKS_ISSUE), child(THEME_ISSUE)]
		const selection = backlog_rank.select({
			candidates,
			pool: candidates,
			read: IDLE,
			repo: REPO,
			standalone: new Set(),
			declared,
		})

		expect(selection.offered.map((entry) => entry.number)).toStrictEqual([CLOCKS_ISSUE])
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
