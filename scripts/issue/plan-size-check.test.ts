import { split_assess } from '#scripts/split/split-assess'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_body_keys } from './issue-body-keys'
import { plan_consumers_section } from './plan-consumers-section'
import { plan_size_check } from './plan-size-check'
import { size_estimate } from './size-estimate'

// joshuafolkken/kit#7734: `issue:plan --planned` judges the plan's estimate by the filing's guide. The
// issue read and the lane measurements are mocked; unmeasured, the guide is its floor.

const { issue_view_json, issue_edit_body } = vi.hoisted(() => ({
	issue_view_json:
		vi.fn<(issue_number: string, fields: string, repo?: string) => Promise<string | undefined>>(),
	issue_edit_body: vi.fn<(issue_number: string, body: string, repo?: string) => Promise<string>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_view_json, issue_edit_body },
}))
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
	issue_edit_body.mockResolvedValue('')
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

describe('plan_size_check.problem_of — the lane measurements', () => {
	it('judges with the lane measurements as the guide’s rates', async () => {
		const guide_problem = vi.spyOn(size_estimate, 'guide_problem')

		await plan_size_check.problem_of('7', plan_of([WITHIN]))

		expect(guide_problem).toHaveBeenCalledWith(expect.any(String), undefined, {
			rate: undefined,
			growth: {},
		})
		guide_problem.mockRestore()
	})
})

describe('plan_size_check.next_steps — the split assessment’s steps', () => {
	it('names the question, the split path and the reason to declare', () => {
		const steps = plan_size_check.next_steps('7')

		expect(steps).toContain(split_assess.QUESTION_SECTION)
		expect(steps).toContain('kickoff #7')
		expect(steps).toContain(split_assess.REASON_PREFIX)
	})

	it('asks for the no-split reason with its kind, as every size refusal does', () => {
		expect(plan_size_check.next_steps('7')).toContain(size_estimate.reason_hint())
	})

	it('addresses a --repo plan’s steps to that repository’s issue', () => {
		const steps = plan_size_check.next_steps('7', OTHER_REPO)

		expect(steps).toContain(`kickoff ${OTHER_REPO}#7`)
		expect(steps).toContain(`issue:plan --planned --repo ${OTHER_REPO}`)
	})
})

// joshuafolkken/kit#7726: the files a plan names are counted against the estimate in force.

const SIX_FILES = `${SIZE_PREFIX} ${issue_body_keys.size_value('6', '110')}`
const EIGHT_FILES = `${SIZE_PREFIX} ${issue_body_keys.size_value('8', '160')}`
// #7695's plan named eight scripts against a six-file estimate.
const EIGHT_SCRIPTS = Array.from(
	{ length: 8 },
	(_, index) => `- \`scripts/a/s${String(index)}.ts\``,
)
const EIGHT_NAMED = 'names 8 file(s)'
const CONSUMERS = [plan_consumers_section.HEADING, '- なし（no concept）']

function named_plan(lines: ReadonlyArray<string>): string {
	return plan_of([...lines, '', ...CONSUMERS])
}

function body_of(lines: ReadonlyArray<string>): string {
	return [BACKGROUND, ...lines].join('\n')
}

describe('plan_size_check.overrun_of — named files against the estimate', () => {
	it('refuses #7695’s plan, listing the named files and the estimate', () => {
		const refusal = plan_size_check.overrun_of(named_plan(EIGHT_SCRIPTS), body_of([SIX_FILES]))

		expect(refusal).toContain(EIGHT_NAMED)
		expect(refusal).toContain(SIX_FILES)
		expect(refusal).toContain('scripts/a/s7.ts')
	})

	it('passes a plan within the estimate', () => {
		const plan = named_plan(EIGHT_SCRIPTS.slice(0, 6))

		expect(plan_size_check.overrun_of(plan, body_of([SIX_FILES]))).toBeUndefined()
	})

	it('judges by the plan’s own estimate line over the issue’s', () => {
		const plan = named_plan([EIGHT_FILES, ...EIGHT_SCRIPTS])

		expect(plan_size_check.overrun_of(plan, body_of([SIX_FILES]))).toBeUndefined()
	})

	it('passes and prints the count when no estimate is declared', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(plan_size_check.overrun_of(named_plan(EIGHT_SCRIPTS), body_of([]))).toBeUndefined()
		expect(info).toHaveBeenCalledWith(expect.stringContaining(EIGHT_NAMED))
		info.mockRestore()
	})
})

describe('plan_size_check.settle — refused, or the issue’s estimate restated', () => {
	it('refuses without writing when the plan names more files than declared', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		issue_view_json.mockResolvedValue(issue_json([SIX_FILES]))

		expect(await plan_size_check.settle('7', named_plan(EIGHT_SCRIPTS))).toBe(false)
		expect(issue_edit_body).not.toHaveBeenCalled()
		error.mockRestore()
	})

	it('restates the issue’s estimate with the plan’s line', async () => {
		issue_view_json.mockResolvedValue(issue_json([SIX_FILES]))

		expect(await plan_size_check.settle('7', named_plan([EIGHT_FILES, ...EIGHT_SCRIPTS]))).toBe(
			true,
		)
		expect(issue_edit_body).toHaveBeenCalledWith('7', body_of([EIGHT_FILES]), undefined)
	})

	it('passes without writing when the issue cannot be read', async () => {
		issue_view_json.mockResolvedValue(undefined)

		expect(await plan_size_check.settle('7', named_plan([EIGHT_FILES]))).toBe(true)
		expect(issue_edit_body).not.toHaveBeenCalled()
	})

	it('refuses when the restated estimate cannot be written', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		issue_view_json.mockResolvedValue(issue_json([SIX_FILES]))
		issue_edit_body.mockRejectedValue(new Error('gh failed'))

		expect(await plan_size_check.settle('7', named_plan([EIGHT_FILES]))).toBe(false)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('Could not restate'))
		error.mockRestore()
	})

	it('writes nothing when the plan states no estimate', async () => {
		expect(await plan_size_check.settle('7', named_plan(['- step']))).toBe(true)
		expect(issue_edit_body).not.toHaveBeenCalled()
	})
})
