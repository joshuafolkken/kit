import { describe, expect, it } from 'vitest'
import { epic_add_fixture, EPIC_FIXTURE_REPO } from './epic-add-fixture'
import { epic_add_plan, type PlanInput, type PlanOutcome } from './epic-add-plan'
import { epic_parse } from './epic-parse'

const { child } = epic_add_fixture
const BLANK = ''

// `#890 -> #891`, with `#892` tracked but unordered.
const BODY = [
	'## Dependencies',
	BLANK,
	'#890 -> #891',
	BLANK,
	'## Progress',
	BLANK,
	'- [ ] #890',
	'- [ ] #891',
	'- [ ] #892',
	BLANK,
].join('\n')

function plan(overrides: Partial<PlanInput>): PlanOutcome {
	return epic_add_plan.build_plan({
		epic_number: 893,
		repo: EPIC_FIXTURE_REPO,
		body: BODY,
		labels: ['epic'],
		children: [894],
		recorded: [child(890), child(891, [890]), child(892)],
		...overrides,
	})
}

function chains_of(outcome: PlanOutcome): Array<Array<number>> {
	if ('error' in outcome) throw new Error(outcome.error)

	return epic_parse.parse_dependency_chains(outcome.plan.body)
}

function error_of(outcome: PlanOutcome): string {
	return 'error' in outcome ? outcome.error : ''
}

describe('epic_add_plan.build_plan — --chain', () => {
	it('writes a join onto an existing child beside the chain already declared', () => {
		const outcome = plan({ chains: [[894, 891]] })

		expect(chains_of(outcome)).toEqual([
			[890, 891],
			[894, 891],
		])
	})

	it('records the declared link as a new blocked-by relation', () => {
		const outcome = plan({ chains: [[892, 894]] })

		expect('plan' in outcome && outcome.plan.added).toEqual([{ blocker: 892, blocked: 894 }])
	})

	it('adds the new child as a task-list row', () => {
		const outcome = plan({ chains: [[892, 894]] })

		expect('plan' in outcome && outcome.plan.body).toContain('- [ ] #894')
	})

	it('does not write a chain the epic already declares twice', () => {
		const outcome = plan({ chains: [[890, 891]] })

		expect(chains_of(outcome)).toEqual([[890, 891]])
	})

	it('refuses a number that is neither added nor a child of the epic', () => {
		expect(error_of(plan({ chains: [[777, 894]] }))).toContain('#777')
	})

	it('refuses a declaration that closes a cycle through an existing chain', () => {
		expect(error_of(plan({ chains: [[891, 890]] }))).toContain('cycle')
	})

	it('leaves the declaration alone when no chain is given', () => {
		expect(chains_of(plan({}))).toEqual([[890, 891]])
	})
})
