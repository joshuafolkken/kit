import { epic_graph, type EpicChild, type GraphAnomaly } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import { EPIC_FIXTURE_REPO, git_epic_add_fixture } from './git-epic-add-fixture'
import { git_epic_add_plan, type PlanInput, type PlanOutcome } from './git-epic-add-plan'
import { git_epic_parse, type DependencyLink } from './git-epic-parse'

// joshuafolkken/kit#1080 — `josh epic --add` recording dependencies nobody declared, on two paths.
//
// Path 1: an add with no position chained onto the last declared chain. Fixed by
// joshuafolkken/kit#1253; the cases here are the shape that actually formed on epic #1061, which the
// issue asks to pin so the same chain cannot come back.
//
// Path 2: `--after <M>` spliced the additions between `#M` and whatever already followed it, which
// recorded `#N -> #<successor>` alongside the `#M -> #N` the position asked for.
//
// These are end-to-end plan cases rather than chain-module cases because the harm is the *relations*
// the command would write, and only the plan computes those.

const { child, plan_of } = git_epic_add_fixture
const REPO = EPIC_FIXTURE_REPO
const DEPENDENCIES_HEADING = '## Dependencies'
const PROGRESS_HEADING = '## Progress'
const BLANK = ''
// Both paths end in the same claim: the declaration the command writes and the relations it records
// say the same thing, so neither `epic:next` nor `epic:audit` has a contradiction to stop on.
const NO_ANOMALY = 'leaves epic:next and epic:audit with nothing to report'

// The epic of joshuafolkken/kit#1108, at the moment `--add 1100 --after 1107` was run on it.
const BRANCH_EPIC = 1108
const DECLARED_BRANCH_CHAIN = '#1107 -> #1099'
const BRANCH_RATIONALE = 'Rationale: #1099 reads what #1107 writes.'

const BRANCH_BODY = [
	DEPENDENCIES_HEADING,
	BLANK,
	DECLARED_BRANCH_CHAIN,
	BRANCH_RATIONALE,
	BLANK,
	PROGRESS_HEADING,
	BLANK,
	'- [ ] #1107',
	'- [ ] #1099',
	BLANK,
].join('\n')

const BRANCH_CHILDREN = [child(1107), child(1099, [1107])]

// The epic of joshuafolkken/kit#1061, at the moment the three unrelated children were added to it
// with no position. Its one real dependency is `#1064 -> #1075`.
const CHAIN_EPIC = 1061
const DECLARED_REAL_CHAIN = '#1064 -> #1075'
const CHAIN_RATIONALE = 'Rationale: #1075 needs the prompt #1064 retires.'
const UNRELATED_CHILDREN = [1077, 1079, 1080]

const CHAIN_BODY = [
	DEPENDENCIES_HEADING,
	BLANK,
	DECLARED_REAL_CHAIN,
	CHAIN_RATIONALE,
	BLANK,
	PROGRESS_HEADING,
	BLANK,
	'- [ ] #1064',
	'- [ ] #1075',
	BLANK,
].join('\n')

const CHAIN_CHILDREN = [child(1064), child(1075, [1064])]

function branch_plan(position: PlanInput['position']): PlanOutcome {
	return git_epic_add_plan.build_plan({
		epic_number: BRANCH_EPIC,
		repo: REPO,
		body: BRANCH_BODY,
		labels: ['epic'],
		children: [1100],
		recorded: BRANCH_CHILDREN,
		position,
	})
}

function chain_plan(): PlanOutcome {
	return git_epic_add_plan.build_plan({
		epic_number: CHAIN_EPIC,
		repo: REPO,
		body: CHAIN_BODY,
		labels: ['epic'],
		children: UNRELATED_CHILDREN,
		recorded: CHAIN_CHILDREN,
	})
}

// The epic as GitHub would hold it once the plan is applied: the new children exist, and every
// relation the plan records is on them. What `epic:next` and `epic:audit` read.
function children_after(
	recorded: ReadonlyArray<EpicChild>,
	additions: ReadonlyArray<number>,
	added: ReadonlyArray<DependencyLink>,
): Array<EpicChild> {
	const present = [...recorded, ...additions.map((issue_number) => child(issue_number))]

	return present.map((entry) => ({
		...entry,
		blocked_by: [
			...entry.blocked_by,
			...added
				.filter((link) => link.blocked === entry.number)
				.map((link) => ({ repo: REPO, number: link.blocker })),
		],
	}))
}

// What `epic:next` and `epic:audit` would report about the epic this plan leaves behind. Both read
// the declaration and the native relations through `find_anomalies`, so an empty list is the two
// agreeing.
function anomalies_of(
	outcome: PlanOutcome,
	recorded: ReadonlyArray<EpicChild>,
): Array<GraphAnomaly> {
	const built = plan_of(outcome)
	const after = children_after(recorded, built.additions, built.added)
	const links = git_epic_parse.parse_dependency_links(built.body)

	return epic_graph.find_anomalies(after, links, true, REPO)
}

describe('josh epic --add — path 2: --after a target that already has a successor', () => {
	it('declares a branch and leaves the existing chain as it stood', () => {
		const inserted = plan_of(branch_plan({ kind: 'after', target: 1107 }))

		expect(inserted.body).toContain(DECLARED_BRANCH_CHAIN)
		expect(inserted.body).toContain('#1107 -> #1100')
	})

	it('records only the link the position asked for', () => {
		const inserted = plan_of(branch_plan({ kind: 'after', target: 1107 }))

		expect(inserted.added).toStrictEqual([{ blocker: 1107, blocked: 1100 }])
		expect(inserted.removed).toStrictEqual([])
	})

	// The splice recorded this, and it is the order nobody declared: #1100 does not block #1099.
	it('never puts the addition in front of the existing successor', () => {
		const inserted = plan_of(branch_plan({ kind: 'after', target: 1107 }))

		expect(inserted.body).not.toContain('#1100 -> #1099')
		expect(inserted.added).not.toContainEqual({ blocker: 1100, blocked: 1099 })
	})

	it(NO_ANOMALY, () => {
		expect(
			anomalies_of(branch_plan({ kind: 'after', target: 1107 }), BRANCH_CHILDREN),
		).toStrictEqual([])
	})

	// Out of scope for the fix and asserted so it stays that way: with no successor to displace,
	// `--after` still extends the chain.
	it('still appends when the target is the tail of its chain', () => {
		const inserted = plan_of(branch_plan({ kind: 'after', target: 1099 }))

		expect(inserted.body).toContain('#1107 -> #1099 -> #1100')
		expect(inserted.added).toStrictEqual([{ blocker: 1099, blocked: 1100 }])
	})
})

describe('josh epic --add — path 1: the chain that formed on epic #1061', () => {
	it('does not chain the unrelated children onto the declared order', () => {
		const added_children = plan_of(chain_plan())

		expect(added_children.body).toContain(DECLARED_REAL_CHAIN)
		expect(added_children.body).not.toContain('#1075 -> #1077')
		expect(added_children.body).not.toContain('#1077 -> #1079')
		expect(added_children.body).not.toContain('#1079 -> #1080')
	})

	it('records no relation for children whose order nobody declared', () => {
		const added_children = plan_of(chain_plan())

		expect(added_children.added).toStrictEqual([])
		expect(added_children.removed).toStrictEqual([])
	})

	it('tracks all three of them all the same', () => {
		const tracked = git_epic_parse.parse_task_list_issue_numbers(plan_of(chain_plan()).body)

		expect(tracked).toStrictEqual([1064, 1075, ...UNRELATED_CHILDREN])
	})

	it(NO_ANOMALY, () => {
		expect(anomalies_of(chain_plan(), CHAIN_CHILDREN)).toStrictEqual([])
	})
})
