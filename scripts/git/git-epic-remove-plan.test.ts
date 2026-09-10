import type { EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import { git_epic_remove_plan, type RemovePlan, type RemovePlanInput } from './git-epic-remove-plan'

const REPO = 'joshuafolkken/kit'
const EPIC = 900
const FIRST = '- [ ] #101'
const SECOND = '- [ ] #102'
const THIRD = '- [ ] #103'
const FIRST_LINK = '#101 -> #102'
const SECOND_LINK = '#102 -> #103'
const CHAIN = `${FIRST_LINK} -> #103`
const UNORDERED = 'None — the children are independent; any execution order works.'
const DEPENDENCIES_HEADING = '## Dependencies'
const PROGRESS_HEADING = '## Progress'
const BLANK = ''
const RECORD = 'The order was never justified.'

function body_of(declaration: string): string {
	return [
		PROGRESS_HEADING,
		BLANK,
		FIRST,
		SECOND,
		THIRD,
		BLANK,
		DEPENDENCIES_HEADING,
		BLANK,
		declaration,
	].join('\n')
}

function child(number: number, blocked_by: ReadonlyArray<number> = []): EpicChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels: [],
		blocked_by: blocked_by.map((blocker) => ({ repo: REPO, number: blocker })),
	}
}

function input_of(overrides: Partial<RemovePlanInput> = {}): RemovePlanInput {
	return {
		epic_number: EPIC,
		body: body_of(CHAIN),
		labels: ['epic'],
		path: [102, 103],
		recorded: [child(101), child(102, [101]), child(103, [102])],
		repo: REPO,
		...overrides,
	}
}

function plan_of(overrides: Partial<RemovePlanInput> = {}): RemovePlan {
	const outcome = git_epic_remove_plan.build_removal_plan(input_of(overrides))

	if ('error' in outcome) throw new Error(outcome.error)

	return outcome.plan
}

function body_after(overrides: Partial<RemovePlanInput> = {}): string {
	return plan_of(overrides).body
}

function error_of(overrides: Partial<RemovePlanInput> = {}): string {
	const outcome = git_epic_remove_plan.build_removal_plan(input_of(overrides))

	return 'error' in outcome ? outcome.error : ''
}

describe('build_removal_plan — the declaration', () => {
	it('drops the named link and leaves the rest of the chain', () => {
		const body = body_after()

		expect(body).toContain(FIRST_LINK)
		expect(body).not.toContain(SECOND_LINK)
	})

	it('never reconnects the ends around a removed middle child', () => {
		expect(body_after({ path: [101, 102, 103] })).not.toContain('#101 -> #103')
	})

	it('writes the unordered sentence when the last declared link goes', () => {
		const body = body_after({ body: body_of(FIRST_LINK), path: [101, 102] })

		expect(body).toContain(UNORDERED)
		expect(body).not.toContain(FIRST_LINK)
	})

	it('keeps every task-list row, because a removal deletes an order and never a child', () => {
		const body = body_after({ body: body_of(FIRST_LINK), path: [101, 102] })

		expect(body).toContain(FIRST)
		expect(body).toContain(SECOND)
		expect(body).toContain(THIRD)
	})

	it('appends the decision record to the epic body', () => {
		const body = body_after({ decision: RECORD })

		expect(body).toContain('## Decisions')
		expect(body).toContain(RECORD)
	})
})

describe('build_removal_plan — the relations', () => {
	it('drops only the links a recorded relation actually backs', () => {
		const plan = plan_of({ path: [101, 102], recorded: [child(101), child(102), child(103)] })

		expect(plan.links).toHaveLength(1)
		expect(plan.removed).toHaveLength(0)
	})

	it('names both ends of every removed order for the decision record', () => {
		expect(plan_of({ path: [101, 102, 103] }).ends).toStrictEqual([101, 102, 103])
	})
})

describe('build_removal_plan — refusals', () => {
	it('refuses a link the declaration does not name', () => {
		expect(error_of({ path: [101, 103] })).toContain('does not name #101 -> #103')
	})

	it('refuses a path with fewer than two issue numbers', () => {
		expect(error_of({ path: [101] })).toContain('Two issue numbers are required')
	})

	it('refuses an issue that is not an epic', () => {
		expect(error_of({ labels: [] })).toContain('does not carry the `epic` label')
	})

	it('refuses a body with no machine-readable declaration', () => {
		expect(error_of({ body: [PROGRESS_HEADING, BLANK, FIRST, SECOND].join('\n') })).toContain(
			'no unambiguous machine-readable',
		)
	})

	it('refuses an empty decision record rather than removing without one', () => {
		expect(error_of({ decision: ' '.repeat(3) })).toContain('decision record is empty')
	})
})
