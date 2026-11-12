import { describe, expect, it } from 'vitest'
import { epic_add_fixture, EPIC_FIXTURE_REPO } from './epic-add-fixture'
import { epic_add_plan } from './epic-add-plan'
import { epic_chains, type InsertOutcome, type InsertPosition } from './epic-chains'

// joshuafolkken/kit#6659: `run:pause --for` declares its blocker with `--before`, and a fan-out hub
// was refused as ambiguous although the place in front of it is the same on every line.

const AMBIGUOUS = 'appears in more than one declared chain'
const TRACKED = [1, 2, 890, 891, 892, 895]
const BEFORE_HUB: InsertPosition = { kind: 'before', target: 890 }
const FAN_OUT = [
	[890, 891],
	[890, 892],
]

function insert(chains: ReadonlyArray<ReadonlyArray<number>>): InsertOutcome {
	return epic_chains.insert_children(chains, [895], BEFORE_HUB, TRACKED)
}

function chains_of(outcome: InsertOutcome): Array<Array<number>> {
	if ('error' in outcome) throw new Error(outcome.error)

	return outcome.chains
}

describe('epic_chains.insert_children — before a target several chains share', () => {
	it('puts the addition in front of a fan-out point on every chain', () => {
		expect(chains_of(insert(FAN_OUT))).toStrictEqual([
			[895, 890, 891],
			[895, 890, 892],
		])
	})

	it('records the shared link once', () => {
		const after = chains_of(insert(FAN_OUT))

		expect(epic_chains.diff_links(FAN_OUT, after)).toStrictEqual({
			added: [{ blocker: 895, blocked: 890 }],
			removed: [],
		})
	})

	it('splices between a shared predecessor and the target on every chain', () => {
		const shared = [
			[1, 890, 891],
			[1, 890, 892],
		]

		expect(chains_of(insert(shared))).toStrictEqual([
			[1, 895, 890, 891],
			[1, 895, 890, 892],
		])
	})

	it('still refuses a target reached from different predecessors', () => {
		const merged = [
			[1, 890],
			[2, 890],
		]

		expect(insert(merged)).toStrictEqual({ error: expect.stringContaining(AMBIGUOUS) })
	})
})

const FAN_OUT_BODY = [
	'## Dependencies',
	'',
	'#890 -> #891',
	'#890 -> #892',
	'',
	'## Progress',
	'',
	'- [ ] #890',
	'- [ ] #891',
	'- [ ] #892',
	'',
].join('\n')

describe('epic_add_plan.build_plan — a prerequisite before a fan-out point', () => {
	it('declares the prerequisite on both chains and records it once', () => {
		const { child, plan_of } = epic_add_fixture
		const added = plan_of(
			epic_add_plan.build_plan({
				epic_number: 893,
				repo: EPIC_FIXTURE_REPO,
				body: FAN_OUT_BODY,
				labels: ['epic'],
				children: [895],
				position: BEFORE_HUB,
				recorded: [child(890), child(891, [890]), child(892, [890])],
			}),
		)

		expect(added.body).toContain('#895 -> #890 -> #891\n#895 -> #890 -> #892')
		expect(added.added).toStrictEqual([{ blocker: 895, blocked: 890 }])
		expect(added.removed).toStrictEqual([])
	})
})

describe('epic_chains.find_position_ambiguity — before a shared target', () => {
	it('answers no ambiguity for a fan-out point', () => {
		expect(epic_chains.find_position_ambiguity(FAN_OUT, BEFORE_HUB)).toBeUndefined()
	})

	it('still answers ambiguity after a merge', () => {
		const merged = [
			[1, 890],
			[2, 890],
		]

		expect(epic_chains.find_position_ambiguity(merged, BEFORE_HUB)).toContain(AMBIGUOUS)
	})
})
