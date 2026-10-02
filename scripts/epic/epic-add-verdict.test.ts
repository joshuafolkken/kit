import { describe, expect, it } from 'vitest'
import { epic_add_fixture, EPIC_FIXTURE_REPO } from './epic-add-fixture'
import { epic_add_plan, type AddPlan } from './epic-add-plan'
import { epic_graph, type EpicChild } from './epic-graph'
import { epic_parse } from './epic-parse'
import { epic_validate } from './epic-validate'

const { child, plan_of } = epic_add_fixture

// What the two readers make of a body `--add` produced.
//
// Rewriting the body correctly is only half the requirement: the epic has to still satisfy
// `epic:check`'s four requirements, and `epic:next` must not report `declaration_mismatch` — the
// anomaly whose verdict is `error`, which is `epicrun`'s stopping condition 3. Asserting both against
// the real checkers is what proves the command does not stop the run it exists to keep going
// (joshuafolkken/kit#890).

const REPO = EPIC_FIXTURE_REPO
const EPIC_NUMBER = 893
const EPIC_BODY = [
	'## Split rationale',
	'',
	'Three separately mergeable pieces.',
	'',
	'## Dependencies',
	'',
	'#890 -> #891 -> #892',
	'',
	'## Execution',
	'',
	'epicrun #893',
	'',
	'## Progress',
	'',
	'- [ ] #890',
	'- [ ] #891',
	'- [ ] #892',
	'',
].join('\n')

const RECORDED = [child(890), child(891, [890]), child(892, [891])]

function plan_for(position?: { kind: 'before' | 'after'; target: number }): AddPlan {
	return plan_of(
		epic_add_plan.build_plan({
			epic_number: EPIC_NUMBER,
			repo: REPO,
			body: EPIC_BODY,
			labels: ['epic'],
			children: [894],
			position,
			recorded: RECORDED,
		}),
	)
}

// The children as they stand once the planned relations have been applied — what `epic:next` would
// read on its next poll.
function apply_to_children(plan: AddPlan): Array<EpicChild> {
	const dropped = new Set(
		plan.removed.map((link) => `${String(link.blocked)}:${String(link.blocker)}`),
	)
	const all = [...RECORDED, ...plan.additions.map((number) => child(number))]

	return all.map((current) => ({
		...current,
		blocked_by: [
			...current.blocked_by.filter(
				(blocker) => !dropped.has(`${String(current.number)}:${String(blocker.number)}`),
			),
			...plan.added
				.filter((link) => link.blocked === current.number)
				.map((link) => ({ repo: REPO, number: link.blocker })),
		],
	}))
}

function anomalies_after(plan: AddPlan): ReturnType<typeof epic_graph.find_anomalies> {
	return epic_graph.find_anomalies(
		apply_to_children(plan),
		epic_parse.parse_dependency_links(plan.body),
		true,
		REPO,
	)
}

function check_failures(plan: AddPlan): Array<string> {
	const results = epic_validate.validate_epic({
		number: EPIC_NUMBER,
		labels: ['epic'],
		body: plan.body,
	})

	return results.filter((result) => !result.is_passing).map((result) => result.name)
}

describe('josh epic --add — the epic still satisfies epic:check', () => {
	it('passes every requirement after a no-position add', () => {
		expect(check_failures(plan_for())).toStrictEqual([])
	})

	it('passes every requirement after an insertion', () => {
		expect(check_failures(plan_for({ kind: 'before', target: 891 }))).toStrictEqual([])
	})
})

describe('josh epic --add — epic:next reports no declaration_mismatch', () => {
	it('finds no anomaly after a no-position add', () => {
		expect(anomalies_after(plan_for())).toStrictEqual([])
	})

	it('finds no anomaly after an insertion that re-points a blocker', () => {
		expect(anomalies_after(plan_for({ kind: 'before', target: 891 }))).toStrictEqual([])
	})

	it('finds no anomaly after an insertion at the head of the chain', () => {
		expect(anomalies_after(plan_for({ kind: 'before', target: 890 }))).toStrictEqual([])
	})

	it('finds no anomaly after an insertion at the tail of the chain', () => {
		expect(anomalies_after(plan_for({ kind: 'after', target: 892 }))).toStrictEqual([])
	})
})
