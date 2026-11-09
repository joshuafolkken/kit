import type { EpicChild } from '#scripts/epic/epic-graph'
import { git_gh_conditional, type ConditionalRead } from '#scripts/gh/git-gh-conditional'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { rest_issue } from '#scripts/gh/git-gh-issue-rest-fixture'
import { TRANSPORT_ENV_VAR } from '#scripts/gh/git-gh-transport'
import { NEEDS_DECISION_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { issue_read, type IssueComment } from '#scripts/issue/issue-read'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_decision_read } from './run-board-decision-read'
import type { BoardPlan } from './run-board-layout'

// joshuafolkken/kit#6700: the board re-reads a decision blocker and a needs-decision child's comments
// every two minutes, so both go with the previous ETag — an unchanged answer is a `304`.

const REPO = 'joshuafolkken/kit'
const WAITING = 6108
const PERSON = 6113
const ASKING = 6114
const TITLE = 'Confirm the promotional credits'
const TAIL = `→ decide #${String(PERSON)}: ${TITLE}`
const QUESTION = 'Which account should run the probe?'
const NEW_QUESTION = 'Which region should run the probe?'
const FIRST_ETAG = 'W/"first"'
const SECOND_ETAG = 'W/"second"'
const COMMENTS_SEGMENT = '/comments'

const PERSON_BODY = rest_issue({
	number: PERSON,
	title: TITLE,
	body: '',
	labels: [{ name: NEEDS_DECISION_LABEL }],
	issue_dependencies_summary: { total_blocked_by: 0 },
})

interface Served {
	issue: ConditionalRead
	comments: ConditionalRead
}

function comments_of(question: string): string {
	return JSON.stringify([{ body: `## ${question}\nneeds-decision` }])
}

function child(number: number, labels: Array<string>, blockers: Array<number> = []): EpicChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels,
		blocked_by: blockers.map((blocker) => ({ repo: REPO, number: blocker, state: 'OPEN' })),
	}
}

function plan_of(): BoardPlan {
	const children = [
		child(WAITING, [RUN_LANE_LABEL], [PERSON]),
		child(ASKING, [NEEDS_DECISION_LABEL]),
	]

	return {
		waves: { waves: [], unreached: children },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set([WAITING, ASKING]) },
		labels: new Map(children.map((node) => [node.number, node.labels])),
		withheld: new Set([WAITING]),
	}
}

function serve(...rounds: Array<Served>): void {
	const read = vi.spyOn(git_gh_conditional, 'read_conditional')
	const queues = {
		issue: rounds.map((round) => round.issue),
		comments: rounds.map((round) => round.comments),
	}

	read.mockImplementation(async (path) => {
		const queue = path.includes(COMMENTS_SEGMENT) ? queues.comments : queues.issue

		return await (queue.shift() ?? { kind: 'unreadable' })
	})
}

// The thread as `parse_comments` answers it, every author trusted: the trust lookup is not under test.
async function trusted_comments(json = '[]'): Promise<ReadonlyArray<IssueComment>> {
	const rows = JSON.parse(json) as Array<{ body: string }>

	return await rows.map(({ body }) => ({ body, author: 'owner', created_at: '', is_trusted: true }))
}

function sent_etags(): Array<string | undefined> {
	return vi.mocked(git_gh_conditional.read_conditional).mock.calls.map(([, etag]) => etag)
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
	shared_cache_fixture.keep_in_memory()
	vi.spyOn(issue_read, 'parse_comments').mockImplementation(trusted_comments)
})

describe('run_board_decision_read.with_decisions — the ETag read', () => {
	it('answers unchanged re-reads from 304, never unconditionally (ac-ba58b897)', async () => {
		const first = { kind: 'changed', etag: FIRST_ETAG } as const
		const unchanged = { kind: 'unchanged' } as const

		serve(
			{
				issue: { ...first, body: PERSON_BODY },
				comments: { ...first, body: comments_of(QUESTION) },
			},
			{ issue: unchanged, comments: unchanged },
		)
		const unconditional = vi.spyOn(git_gh_exec, 'exec_gh_api')

		await run_board_decision_read.with_decisions(plan_of())
		const plan = await run_board_decision_read.with_decisions(plan_of())

		expect(plan?.decision_questions?.get(ASKING)).toBe(QUESTION)
		expect(plan?.decision_waits?.get(WAITING)).toBe(TAIL)
		expect(sent_etags().slice(2)).toStrictEqual([FIRST_ETAG, FIRST_ETAG])
		expect(unconditional).not.toHaveBeenCalled()
	})

	it('updates the question when the thread changed under a new ETag (ac-b71b08f4)', async () => {
		const issue = { kind: 'unchanged' } as const

		serve(
			{
				issue: { kind: 'changed', etag: FIRST_ETAG, body: PERSON_BODY },
				comments: { kind: 'changed', etag: FIRST_ETAG, body: comments_of(QUESTION) },
			},
			{ issue, comments: { kind: 'changed', etag: SECOND_ETAG, body: comments_of(NEW_QUESTION) } },
		)

		const before = await run_board_decision_read.with_decisions(plan_of())
		const after = await run_board_decision_read.with_decisions(plan_of())

		expect(before?.decision_questions?.get(ASKING)).toBe(QUESTION)
		expect(after?.decision_questions?.get(ASKING)).toBe(NEW_QUESTION)
	})
})
