import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { epic_issue } from './epic-issue'
import { epic_plan, type PlanChild } from './epic-plan'
import { epic_plan_cli } from './epic-plan-cli'

const EPIC = 858
const OPEN = 'OPEN'
const NUMBER_ONLY = JSON.stringify({ number: 101 })
const IN_PROGRESS = 'in-progress'

// The shape a `number,title,body,state,labels,blockedBy` read answers with — `gh api` since
// joshuafolkken/kit#1024, mapped back into the field names `gh issue view --json` used.
function gh_issue(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		number: 101,
		title: 'A child',
		body: 'Its body.',
		state: OPEN,
		labels: [{ name: IN_PROGRESS }],
		blockedBy: { nodes: [{ number: 100 }], totalCount: 1 },
		...overrides,
	})
}

function child(number: number): PlanChild {
	return { number, title: '', body: '', state: OPEN, labels: [], blocked_by: [] }
}

describe('epic_plan.to_plan_child', () => {
	it('reads every field the decision needs', () => {
		const parsed = epic_plan.to_plan_child(gh_issue())

		expect(parsed).toEqual({
			number: 101,
			title: 'A child',
			body: 'Its body.',
			state: OPEN,
			labels: [IN_PROGRESS],
			blocked_by: [100],
		})
	})

	it('unwraps the blockedBy connection gh answers with', () => {
		const parsed = epic_plan.to_plan_child(gh_issue({ blockedBy: { nodes: [], totalCount: 0 } }))

		expect(parsed?.blocked_by).toEqual([])
	})
})

// A child reported with a field missing is still a child the decision has to account for; dropping
// it would hide it from the one view the decision is made from.
describe('epic_plan.to_plan_child — missing fields', () => {
	it('reports a child with no title as having an empty one', () => {
		expect(epic_plan.to_plan_child(NUMBER_ONLY)?.title).toBe('')
	})

	// REST answers JSON null for an issue with no body. `git-gh-issue-rest.ts` maps that to an empty
	// string before this parser sees it; the schema tolerates it anyway, and this asserts that guard.
	it('reports a null body as an empty one', () => {
		// eslint-disable-next-line unicorn/no-null -- the shape REST's JSON actually produces
		expect(epic_plan.to_plan_child(gh_issue({ body: null }))?.body).toBe('')
	})

	it('reports an absent state rather than guessing one', () => {
		const parsed = epic_plan.to_plan_child(NUMBER_ONLY)

		expect(parsed?.state).toBe(epic_plan.UNKNOWN_STATE)
	})

	it('reports a child with no labels or relations as having none', () => {
		const parsed = epic_plan.to_plan_child(NUMBER_ONLY)

		expect(parsed?.labels).toEqual([])
		expect(parsed?.blocked_by).toEqual([])
	})

	it('refuses a response with no issue number at all', () => {
		expect(epic_plan.to_plan_child(JSON.stringify({ title: 'no number' }))).toBeUndefined()
	})

	it('refuses a response that is not JSON', () => {
		expect(epic_plan.to_plan_child('gh: Not Found (HTTP 404)')).toBeUndefined()
	})

	it('refuses a missing response', () => {
		expect(epic_plan.to_plan_child(undefined)).toBeUndefined()
	})
})

describe('epic_plan.build_plan', () => {
	// An epic whose children are all closed is a finished epic; failing there would make the command
	// unusable at the point a run asks whether anything is left.
	it('treats an epic with no children as an empty plan, not a failure', () => {
		expect(epic_plan.build_plan(EPIC, [])).toEqual({ epic: EPIC, children: [] })
	})

	it('orders the children by number, so the plan is reproducible', () => {
		const plan = epic_plan.build_plan(EPIC, [child(103), child(101)])

		expect(plan.children.map((entry) => entry.number)).toEqual([101, 103])
	})

	it('names the epic the plan is for', () => {
		expect(epic_plan.build_plan(EPIC, []).epic).toBe(EPIC)
	})
})

describe('epic_plan.format_plan', () => {
	it('produces JSON a program can read back', () => {
		const plan = epic_plan.build_plan(EPIC, [child(101)])
		const parsed: unknown = JSON.parse(epic_plan.format_plan(plan))

		expect(parsed).toEqual(plan)
	})

	it('indents it, since a person reads it too', () => {
		const plan = epic_plan.build_plan(EPIC, [child(101)])

		expect(epic_plan.format_plan(plan)).toContain('\n')
	})
})

// Single-sourced: three commands take the same argument, and each had its own byte-identical copy.
describe('epic_issue.parse_epic_number', () => {
	it('accepts a bare number and a hash-prefixed one', () => {
		expect(epic_issue.parse_epic_number('858')).toBe(EPIC)
		expect(epic_issue.parse_epic_number('#858')).toBe(EPIC)
	})

	it('refuses anything that is not a positive issue number', () => {
		for (const raw of ['', 'abc', '0', 'joshuafolkken/kit#858']) {
			expect(epic_issue.parse_epic_number(raw)).toBeUndefined()
		}
	})
})

describe('epic_plan_cli.report_missing', () => {
	it('passes when nothing was missing', () => {
		expect(epic_plan_cli.report_missing([])).toBe(0)
	})

	// A consumer capturing stdout would otherwise act on a plan that is missing a child, which is a
	// decision made without knowing about it.
	it('fails rather than only warning when a child is absent', () => {
		expect(epic_plan_cli.report_missing([101])).toBe(1)
	})
})

describe('josh epic:plan registration', () => {
	it('is registered as a command', () => {
		const entry = COMMAND_MAP['epic:plan']

		expect(entry?.script).toBe('scripts/epic/epic-plan-cli.ts')
	})

	it('is reachable through the el alias', () => {
		const { el } = ALIASES

		expect(el).toBe('epic:plan')
	})
})
