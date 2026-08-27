import { describe, expect, it } from 'vitest'
import { git_epic_chains, type InsertOutcome } from './git-epic-chains'

const LINEAR = [[890, 891, 892]]
const NOT_A_CHILD = 'is not a child of this epic'
// Every number these cases position against. `insert_children` requires the epic's task list, and
// what each case is about is the chains — so the list is supplied once here and overridden where a
// case is specifically about a target the epic does not track.
const ALL_TRACKED = [1, 2, 3, 890, 891, 892, 893, 894, 895]

function insert(
	chains: ReadonlyArray<ReadonlyArray<number>>,
	additions: ReadonlyArray<number>,
	position: Parameters<typeof git_epic_chains.insert_children>[2],
	tracked: ReadonlyArray<number> = ALL_TRACKED,
): InsertOutcome {
	return git_epic_chains.insert_children(chains, additions, position, tracked)
}

function chains_of(outcome: InsertOutcome): Array<Array<number>> {
	if ('error' in outcome) throw new Error(outcome.error)

	return outcome.chains
}

function error_of(outcome: InsertOutcome): string {
	if ('chains' in outcome) throw new Error('expected a refusal')

	return outcome.error
}

describe('git_epic_chains.insert_children — where the child lands', () => {
	it('appends to the last chain when no position is given', () => {
		expect(chains_of(insert(LINEAR, [894], undefined))).toStrictEqual([[890, 891, 892, 894]])
	})

	it('inserts before the target', () => {
		const outcome = insert(LINEAR, [894], {
			kind: 'before',
			target: 891,
		})

		expect(chains_of(outcome)).toStrictEqual([[890, 894, 891, 892]])
	})

	it('inserts after the target', () => {
		const outcome = insert(LINEAR, [894], { kind: 'after', target: 891 })

		expect(chains_of(outcome)).toStrictEqual([[890, 891, 894, 892]])
	})

	it('inserts several children in the order given', () => {
		const outcome = insert(LINEAR, [894, 895], {
			kind: 'before',
			target: 892,
		})

		expect(chains_of(outcome)).toStrictEqual([[890, 891, 894, 895, 892]])
	})
})

describe('git_epic_chains.insert_children — an unordered batch', () => {
	it('stays unordered when no position is given', () => {
		expect(chains_of(insert([], [894], undefined))).toStrictEqual([])
	})

	it('starts a chain when given a position', () => {
		const outcome = insert([], [894], { kind: 'before', target: 891 })

		expect(chains_of(outcome)).toStrictEqual([[894, 891]])
	})
})

describe('git_epic_chains.insert_children — several chains', () => {
	it('touches only the chain that names the target', () => {
		const outcome = insert(
			[
				[1, 2],
				[3, 4],
			],
			[9],
			{ kind: 'after', target: 3 },
		)

		expect(chains_of(outcome)).toStrictEqual([
			[1, 2],
			[3, 9, 4],
		])
	})
})

describe('git_epic_chains.insert_children — what it refuses', () => {
	// Reworded by joshuafolkken/kit#949: "not named in the declared order" became a legitimate state —
	// a child with no order constraint — so the only surviving reason is that the target is not a
	// child, which is what the workflow docs tell the operator to expect.
	it('refuses a target the epic does not track', () => {
		const outcome = insert(LINEAR, [894], { kind: 'before', target: 999 })

		expect(error_of(outcome)).toContain(`#999 ${NOT_A_CHILD}`)
	})

	it('refuses a target that appears in more than one chain', () => {
		const outcome = insert(
			[
				[1, 2],
				[2, 3],
			],
			[9],
			{ kind: 'before', target: 2 },
		)

		expect(error_of(outcome)).toContain('appears in more than one declared chain')
	})

	it('refuses a declaration that names one issue twice', () => {
		const outcome = insert([[1, 2, 1]], [9], undefined)

		expect(error_of(outcome)).toContain('names #1 twice')
	})
})

describe('git_epic_chains.render_chains', () => {
	it('writes one arrow line per chain', () => {
		expect(
			git_epic_chains.render_chains([
				[890, 891],
				[1, 2, 3],
			]),
		).toStrictEqual(['#890 -> #891', '#1 -> #2 -> #3'])
	})

	it('drops a chain too short to be a declaration', () => {
		expect(git_epic_chains.render_chains([[890]])).toStrictEqual([])
	})
})

describe('git_epic_chains.diff_links — what an insertion changes', () => {
	it('re-points the blocker of the target when inserting before it', () => {
		const after = chains_of(insert(LINEAR, [894], { kind: 'before', target: 891 }))
		const diff = git_epic_chains.diff_links(LINEAR, after)

		expect(diff.added).toStrictEqual([
			{ blocker: 890, blocked: 894 },
			{ blocker: 894, blocked: 891 },
		])
		expect(diff.removed).toStrictEqual([{ blocker: 890, blocked: 891 }])
	})

	it('removes nothing when the child is appended to the end', () => {
		const after = chains_of(insert(LINEAR, [894], undefined))
		const diff = git_epic_chains.diff_links(LINEAR, after)

		expect(diff.added).toStrictEqual([{ blocker: 892, blocked: 894 }])
		expect(diff.removed).toStrictEqual([])
	})

	it('inserting at the head of a chain removes nothing', () => {
		const after = chains_of(insert(LINEAR, [894], { kind: 'before', target: 890 }))

		expect(git_epic_chains.diff_links(LINEAR, after).removed).toStrictEqual([])
	})
})

describe('git_epic_chains.insert_children — the result is checked too', () => {
	it('refuses an addition the chain already names', () => {
		const outcome = insert(LINEAR, [891], undefined)

		expect(error_of(outcome)).toContain('#891 is already named in the declared dependency order')
	})

	it('refuses a positioned addition the chain already names', () => {
		const outcome = insert(LINEAR, [892], {
			kind: 'before',
			target: 891,
		})

		expect(error_of(outcome)).toContain('would have it block itself')
	})
})

// joshuafolkken/kit#949: an epic can mix ordered and unordered children — a child with no order
// constraint is legitimately absent from every chain. `--before` on such a child was refused with
// "is not named in the declared dependency order", which left a prerequisite discovered against it
// with nowhere to be recorded. The refusal is right for a number that is not a child at all; the two
// were indistinguishable because this module sees only chains.
describe('git_epic_chains.insert_children — a child the chains do not name', () => {
	// Two chains, and #895 tracked by the epic but named in neither.
	const MIXED = [
		[890, 891],
		[892, 893],
	]
	const TRACKED = [890, 891, 892, 893, 895]

	it('declares a new chain before a tracked but unordered target', () => {
		const outcome = insert(MIXED, [894], { kind: 'before', target: 895 }, TRACKED)

		expect(chains_of(outcome)).toStrictEqual([
			[890, 891],
			[892, 893],
			[894, 895],
		])
	})

	it('declares a new chain after a tracked but unordered target', () => {
		const outcome = insert(MIXED, [894], { kind: 'after', target: 895 }, TRACKED)

		expect(chains_of(outcome)).toStrictEqual([
			[890, 891],
			[892, 893],
			[895, 894],
		])
	})
})

describe('git_epic_chains.insert_children — what the new chain leaves alone', () => {
	const MIXED = [
		[890, 891],
		[892, 893],
	]
	const TRACKED = [890, 891, 892, 893, 895]

	// The existing declarations are somebody else's intent; a new chain must not disturb them.
	it('leaves the existing chains exactly as they were', () => {
		const outcome = insert(MIXED, [894], { kind: 'before', target: 895 }, TRACKED)

		expect(chains_of(outcome).slice(0, MIXED.length)).toStrictEqual(MIXED)
	})
})

describe('git_epic_chains.insert_children — what a missing task list still refuses', () => {
	const MIXED = [
		[890, 891],
		[892, 893],
	]
	const TRACKED = [890, 891, 892, 893, 895]

	// The distinction the whole change rests on: "has no order yet" is not "is not a child".
	it('still refuses a target the epic does not track', () => {
		const outcome = insert(MIXED, [894], { kind: 'before', target: 999 }, TRACKED)

		expect(error_of(outcome)).toContain(NOT_A_CHILD)
	})

	// The new chain is a real declaration, so the relations it implies have to fall out of the diff
	// the caller applies — otherwise the body would declare an order nothing records.
	it('produces the relation the new chain declares', () => {
		const outcome = insert(MIXED, [894], { kind: 'before', target: 895 }, TRACKED)

		expect(git_epic_chains.diff_links(MIXED, chains_of(outcome)).added).toStrictEqual([
			{ blocker: 894, blocked: 895 },
		])
	})
})

// joshuafolkken/kit#949, second review: both holes are reachable only from this module, because
// `build_plan` filters the same inputs first. That is exactly why they are asserted here — a guard
// whose only proof is a caller's filter is a guard that stops working the day a second caller
// arrives.
describe('git_epic_chains.insert_children — guards the caller happens to duplicate', () => {
	const TRACKED = [890, 891, 892, 893, 895]

	// The empty-declaration path used to skip the task-list check entirely, so the same input was
	// accepted or refused depending only on whether anything had been declared yet.
	it('refuses an untracked target even when nothing is declared yet', () => {
		const outcome = insert([], [894], { kind: 'before', target: 999 }, [890, 891])

		expect(error_of(outcome)).toContain(NOT_A_CHILD)
	})

	it('still starts the first chain for a tracked target', () => {
		const outcome = insert([], [894], { kind: 'before', target: 891 }, TRACKED)

		expect(chains_of(outcome)).toStrictEqual([[894, 891]])
	})
})

describe('git_epic_chains.insert_children — duplicates across chains', () => {
	const MIXED = [
		[890, 891],
		[892, 893],
	]
	const TRACKED = [890, 891, 892, 893, 895]

	// `add_chain` writes into a chain the addition is not in, so the intra-chain out-guard cannot see
	// a repeat that lands in a different one.
	it('refuses an addition another chain already declares', () => {
		const outcome = insert(MIXED, [891], { kind: 'before', target: 895 }, TRACKED)

		expect(error_of(outcome)).toContain('is already named in the declared dependency order')
	})

	// The out-guard must not be widened into an across-chain scan: one issue named by two chains is a
	// fan-out, which is a legitimate declaration.
	it('accepts a fan-out, where two chains share a head', () => {
		const outcome = insert(
			[
				[890, 891],
				[890, 892],
			],
			[894],
			{ kind: 'after', target: 891 },
			[890, 891, 892],
		)

		expect(chains_of(outcome)).toStrictEqual([
			[890, 891, 894],
			[890, 892],
		])
	})
})
