import { split_assess } from '#scripts/split/split-assess'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_body_keys } from './issue-body-keys'
import { plan_size_check } from './plan-size-check'

// joshuafolkken/kit#7734: `issue:plan --planned` judges the plan's estimate by the filing's guide. The
// issue read and the lane measurements are mocked; unmeasured, the guide is its floor.

const { issue_view_json } = vi.hoisted(() => ({
	issue_view_json:
		vi.fn<(issue_number: string, fields: string, repo?: string) => Promise<string | undefined>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: { issue_view_json } }))
vi.mock('#scripts/lane/lane-net-read', () => ({
	lane_net_read: {
		measurements: vi.fn(async () => await { implement_rate: undefined, growth: {} }),
	},
}))

const BACKGROUND = issue_body_keys.heading('background')
const SIZE_PREFIX = issue_body_keys.prefix('size')
const OVER = `${SIZE_PREFIX} ${issue_body_keys.size_value('30', '600')}`
const WITHIN = `${SIZE_PREFIX} ${issue_body_keys.size_value('1', '10')}`
const REASON = `${split_assess.REASON_PREFIX} one deliverable`
const OTHER_REPO = 'joshuafolkken/kit'

function issue_json(lines: ReadonlyArray<string>, labels: ReadonlyArray<string> = []): string {
	const body = [BACKGROUND, ...lines].join('\n')

	return JSON.stringify({ body, labels: labels.map((name) => ({ name })) })
}

function plan_of(lines: ReadonlyArray<string>): string {
	return ['## 計画', ...lines].join('\n')
}

beforeEach(() => {
	issue_view_json.mockResolvedValue(issue_json([WITHIN]))
})

describe('plan_size_check.problem_of — the plan’s estimate is judged by the filing’s guide', () => {
	it('refuses a plan whose estimate is over the guide', async () => {
		const problem = await plan_size_check.problem_of('7', plan_of([OVER]))

		expect(problem).toContain(split_assess.QUESTION_SECTION)
	})

	it('passes a plan within the guide', async () => {
		expect(await plan_size_check.problem_of('7', plan_of([WITHIN]))).toBeUndefined()
	})

	it.each([
		{ name: 'the plan', plan: [OVER, REASON], issue: [WITHIN] },
		{ name: 'the issue body', plan: [OVER], issue: [WITHIN, REASON] },
	])('passes an estimate over the guide when $name declares why it stays one', async (row) => {
		issue_view_json.mockResolvedValue(issue_json(row.issue))

		expect(await plan_size_check.problem_of('7', plan_of(row.plan))).toBeUndefined()
	})

	it('judges the issue body’s estimate when the plan states none', async () => {
		issue_view_json.mockResolvedValue(issue_json([OVER]))

		expect(await plan_size_check.problem_of('7', plan_of(['- step one']))).toBeDefined()
	})

	it('keeps the issue body’s estimate when the plan’s line does not parse', async () => {
		issue_view_json.mockResolvedValue(issue_json([OVER]))

		expect(await plan_size_check.problem_of('7', plan_of([`${SIZE_PREFIX} many`]))).toBeDefined()
	})

	it('reads the issue from the named repository', async () => {
		await plan_size_check.problem_of('7', plan_of([WITHIN]), OTHER_REPO)

		expect(issue_view_json).toHaveBeenCalledWith('7', expect.any(String), OTHER_REPO)
	})

	it('passes when the issue cannot be read', async () => {
		issue_view_json.mockResolvedValue(undefined)

		expect(await plan_size_check.problem_of('7', plan_of([OVER]))).toBeUndefined()
	})
})

describe('plan_size_check.next_steps — the split assessment’s steps', () => {
	it('names the question, the split path and the reason to declare', () => {
		const steps = plan_size_check.next_steps('7')

		expect(steps).toContain(split_assess.QUESTION_SECTION)
		expect(steps).toContain('kickoff #7')
		expect(steps).toContain(split_assess.REASON_PREFIX)
	})

	it('addresses a --repo plan’s steps to that repository’s issue', () => {
		const steps = plan_size_check.next_steps('7', OTHER_REPO)

		expect(steps).toContain(`kickoff ${OTHER_REPO}#7`)
		expect(steps).toContain(`issue:plan --planned --repo ${OTHER_REPO}`)
	})
})
