import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import { git_epic_add_plan, type AddPlan } from './git-epic-add-plan'
import { git_epic_parse } from './git-epic-parse'
import { git_epic_validate } from './git-epic-validate'

// What the two readers make of a body `--add` produced.
//
// Rewriting the body correctly is only half the requirement: the epic has to still satisfy
// `epic:check`'s four requirements, and `epic:next` must not report `declaration_mismatch` — the
// anomaly whose verdict is `error`, which is `epicrun`'s stopping condition 3. Asserting both against
// the real checkers is what proves the command does not stop the run it exists to keep going
// (joshuafolkken/kit#890).

const REPO = 'joshuafolkken/kit'
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

function child(number: number, blocked_by: ReadonlyArray<number> = []): EpicChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels: [],
		blocked_by: blocked_by.map((blocker) => ({ repo: REPO, number: blocker })),
	}
}

const RECORDED = [child(890), child(891, [890]), child(892, [891])]

function plan_for(position?: { kind: 'before' | 'after'; target: number }): AddPlan {
	const outcome = git_epic_add_plan.build_plan({
		epic_number: EPIC_NUMBER,
		repo: REPO,
		body: EPIC_BODY,
		labels: ['epic'],
		children: [894],
		position,
		recorded: RECORDED,
	})
	if ('error' in outcome) throw new Error(outcome.error)

	return outcome.plan
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
		git_epic_parse.parse_dependency_links(plan.body),
		true,
		REPO,
	)
}

function check_failures(plan: AddPlan): Array<string> {
	const results = git_epic_validate.validate_epic({
		number: EPIC_NUMBER,
		labels: ['epic'],
		body: plan.body,
	})

	return results.filter((result) => !result.is_passing).map((result) => result.name)
}

describe('josh epic --add — the epic still satisfies epic:check', () => {
	it('passes every requirement after an append', () => {
		expect(check_failures(plan_for())).toStrictEqual([])
	})

	it('passes every requirement after an insertion', () => {
		expect(check_failures(plan_for({ kind: 'before', target: 891 }))).toStrictEqual([])
	})
})

describe('josh epic --add — epic:next reports no declaration_mismatch', () => {
	it('finds no anomaly after an append', () => {
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
