import type { EpicChild } from '#scripts/epic/epic-graph'
import { git_gh_etag_read } from '#scripts/gh/git-gh-etag-read'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { TRANSPORT_ENV_VAR } from '#scripts/gh/git-gh-transport'
import { NEEDS_DECISION_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { issue_read } from '#scripts/issue/issue-read'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_decision } from './run-board-decision'
import { run_board_decision_read } from './run-board-decision-read'
import { run_board_layout, type BoardPlan } from './run-board-layout'
import { run_board_reason } from './run-board-reason'

const REPO = 'joshuafolkken/kit'
const WAITING = 6108
const MIDDLE = 6048
const PERSON = 6113
const TITLE = 'Confirm the promotional credits'
const QUESTION = 'Which account should run the probe?'
const DETAIL = '外部アカウント'
const TAIL = `→ decide #${String(PERSON)}: ${TITLE} (${DETAIL})`
const MISSING_PLAN = 'Missing plan'

function child(number: number, blockers: ReadonlyArray<number> = []): EpicChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels: [RUN_LANE_LABEL],
		blocked_by: blockers.map((blocker) => ({ repo: REPO, number: blocker, state: 'OPEN' })),
	}
}

function plan_of(children: Array<EpicChild>): BoardPlan {
	return {
		waves: { waves: [], unreached: children },
		tracked: new Map(),
		context: {
			repo: REPO,
			titles: new Map([[PERSON, TITLE]]),
			open_numbers: new Set([WAITING, MIDDLE, PERSON]),
		},
		labels: new Map(children.map((node) => [node.number, node.labels])),
		withheld: new Set([WAITING, MIDDLE]),
	}
}

// The REST read is under test here; the GraphQL one is `run-board-decision-graphql.test.ts`'s.
beforeEach(() => {
	vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
	vi.spyOn(git_gh_issue_read, 'issue_view_json').mockResolvedValue(
		JSON.stringify({
			number: PERSON,
			title: TITLE,
			state: 'OPEN',
			body: `- 人の判断: 要（${DETAIL}）`,
			labels: [{ name: NEEDS_DECISION_LABEL }],
		}),
	)
	vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue('[]')
})

describe('run_board_decision', () => {
	it('prefers a park question, then a comment heading, then the title (ac-f0bf440f)', () => {
		const read = {
			titles: new Map([[PERSON, TITLE]]),
			labels: new Map(),
			decision_questions: new Map([[PERSON, QUESTION]]),
		}

		expect(run_board_decision.reason_of(PERSON, 'needs-decision: pick one', read)?.tail).toBe(
			'→ decide: pick one',
		)
		expect(run_board_decision.reason_of(PERSON, 'needs-decision', read)?.tail).toBe(
			`→ decide: ${QUESTION}`,
		)
		expect(
			run_board_decision.reason_of(PERSON, 'needs-decision; blocker #6428 closed', read)?.tail,
		).toBe(`→ decide: ${QUESTION} (blocker #6428 closed)`)
		expect(
			run_board_decision.reason_of(PERSON, undefined, { ...read, decision_questions: undefined })
				?.tail,
		).toBe(`→ decide: ${TITLE}`)
	})

	it('uses the last trusted decision comment heading outside code fences', () => {
		const bodies = ['## Old question\nneeds-decision', `\`\`\`\n## example\n\`\`\`\n## ${QUESTION}`]

		expect(run_board_decision.comment_question(bodies)).toBe(QUESTION)
		expect(
			run_board_decision.comment_question(['needs-decision without a heading']),
		).toBeUndefined()
	})
})

const PARK_OPTIONS = [
	'### 選択肢',
	'1. Keep the account',
	'   - 層: A',
	'   - 必要な権限: owner コメント',
	'2. Rotate the account',
	'   - 層: C',
	'   - 必要な権限: 人',
].join('\n')

const PICK_ONE = '1 cheaper'
const PICK_ONE_SUMMARY = '推奨: 1（層 A）'

function park_body(heading: string, pick: string): string {
	return `${heading}${PARK_OPTIONS}\n\n### 推奨\n${pick}\n`
}

describe('run_board_decision park summary (ac-0be6b188)', () => {
	it.each([
		[park_body(`## ${QUESTION}\n\n`, '2 the key leaked'), `${QUESTION} — 推奨: 2（層 C）`],
		[park_body(`## ${QUESTION}\n\n`, '推奨なし both need the owner'), `${QUESTION} — 推奨なし`],
		[park_body('', PICK_ONE), PICK_ONE_SUMMARY],
	])('shows the recommendation and tier on the park row: %s', (body, expected) => {
		expect(run_board_decision.comment_question([body])).toBe(expected)
	})
})

// joshuafolkken/kit#7001: a child parked again after an adoption shows its round on the park row.
describe('run_board_decision park round (ac-80f5c282)', () => {
	const park = park_body('', PICK_ONE)
	const adopted = '#7001: adopted park option 1 (backlog:triage --adopt) — cheaper'

	it('marks the second park after an adoption', () => {
		expect(run_board_decision.comment_question([park, adopted, park])).toBe(
			`${PICK_ONE_SUMMARY} — park 2 回目`,
		)
	})

	it('adds no round to the first park', () => {
		expect(run_board_decision.comment_question([adopted, park])).toBe(PICK_ONE_SUMMARY)
	})

	it('adds no round when the latest comment is no park, so the title fallback stays', () => {
		expect(run_board_decision.comment_question([park, adopted, park, adopted])).toBeUndefined()
	})
})

describe('run_board_decision waiting detail', () => {
	it.each(['', '- 人の判断: 不要'])(
		'omits the detail when the body has no human detail: %s',
		(body) => {
			expect(run_board_decision.waiting_tail('#6113', TITLE, body)).toBe(`→ decide #6113: ${TITLE}`)
		},
	)
})

describe('run_board_decision_read.with_decisions', () => {
	it('follows a withheld intermediate issue to the outside human blocker once (ac-ab804afc)', async () => {
		const children = [child(WAITING, [MIDDLE]), child(MIDDLE, [PERSON])]
		const plan = await run_board_decision_read.with_decisions(plan_of(children))

		expect(plan?.decision_waits).toEqual(
			new Map([
				[WAITING, TAIL],
				[MIDDLE, TAIL],
			]),
		)
		expect(git_gh_issue_read.issue_view_json).toHaveBeenCalledTimes(1)
		expect(git_gh_issue_read.issue_view_json).toHaveBeenCalledWith(
			String(PERSON),
			'number,title,body,state,labels,blockedBy',
			REPO,
			git_gh_etag_read.read,
		)
	})
})

describe('run_board_decision_read question comments', () => {
	it('loads trusted comment questions for untouched decision rows', async () => {
		const person = { ...child(PERSON), labels: [NEEDS_DECISION_LABEL] }

		vi.spyOn(issue_read, 'parse_comments').mockResolvedValue([
			{ body: `## ${QUESTION}\nneeds-decision`, author: 'owner', created_at: '', is_trusted: true },
			{
				body: '## Untrusted\nneeds-decision',
				author: 'stranger',
				created_at: '',
				is_trusted: false,
			},
		])
		const plan = await run_board_decision_read.with_decisions(plan_of([person]))

		if (plan === undefined) throw new Error(MISSING_PLAN)
		const layout = run_board_layout.layout_of(plan, new Map())

		expect(plan.decision_questions?.get(PERSON)).toBe(QUESTION)
		expect(layout.people[0]?.reason?.tail).toBe(`→ decide: ${QUESTION}`)
	})
})

describe('run_board_decision_read row integration', () => {
	it('puts the waiting decision on the row through the normal reason reader (ac-9dd9ea00)', async () => {
		const waiting = child(WAITING, [PERSON])
		const plan = await run_board_decision_read.with_decisions(plan_of([waiting]))

		if (plan === undefined) throw new Error(MISSING_PLAN)
		const reader = run_board_reason.reader({
			plan,
			statuses: new Map(),
			events: [],
			free_lanes: 1,
			is_stopped: false,
			now_ms: 0,
		})
		const layout = run_board_layout.layout_of(plan, new Map(), reader)

		expect(layout.unreached[0]?.reason).toEqual({
			icon: '🙋',
			issues: [String(PERSON)],
			tail: TAIL,
		})
	})
})

describe('run_board_decision_read cyclic blockers', () => {
	it('ends cycles without inventing a decision', async () => {
		const cycle = [child(WAITING, [MIDDLE]), child(MIDDLE, [WAITING])]
		const plan = await run_board_decision_read.with_decisions(plan_of(cycle))

		expect(plan?.decision_waits?.size).toBe(0)
		expect(git_gh_issue_read.issue_view_json).not.toHaveBeenCalled()
	})
})

describe('run_board_decision_read standing blockers', () => {
	it('names an outside human blocker even when it has its own open dependency', async () => {
		vi.mocked(git_gh_issue_read.issue_view_json).mockResolvedValue(
			JSON.stringify({
				number: PERSON,
				title: TITLE,
				state: 'OPEN',
				body: `- 人の判断: 要（${DETAIL}）`,
				blockedBy: { nodes: [{ number: MIDDLE, state: 'OPEN' }] },
			}),
		)
		const enriched = await run_board_decision_read.with_decisions(
			plan_of([child(WAITING, [PERSON])]),
		)

		expect(enriched?.decision_waits?.get(WAITING)).toBe(TAIL)
		expect(git_gh_issue_read.issue_view_json).toHaveBeenCalledTimes(1)
	})

	it.each(['CLOSED', 'OPEN'] as const)('skips a %s blocker the run can finish', async (state) => {
		const blocker = { ...child(PERSON), state }
		const plan = await run_board_decision_read.with_decisions(
			plan_of([child(WAITING, [PERSON]), blocker]),
		)

		expect(plan?.decision_waits?.size).toBe(0)
	})

	it('keeps outside human blockers even when they appear in the open listing', async () => {
		const plan = plan_of([child(WAITING, [PERSON])])
		const labels = new Map([...plan.labels, [PERSON, []]])

		vi.mocked(git_gh_issue_read.issue_view_json).mockResolvedValue(
			JSON.stringify({ number: PERSON, title: TITLE, state: 'OPEN' }),
		)
		const enriched = await run_board_decision_read.with_decisions({ ...plan, labels })

		expect(enriched?.decision_waits?.get(WAITING)).toBe(`→ decide #6113: ${TITLE}`)
	})
})
