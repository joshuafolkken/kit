import { describe, expect, it } from 'vitest'
import { git_epic_chains, type InsertOutcome } from './git-epic-chains'

const LINEAR = [[890, 891, 892]]

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
		expect(chains_of(git_epic_chains.insert_children(LINEAR, [894], undefined))).toStrictEqual([
			[890, 891, 892, 894],
		])
	})

	it('inserts before the target', () => {
		const outcome = git_epic_chains.insert_children(LINEAR, [894], {
			kind: 'before',
			target: 891,
		})

		expect(chains_of(outcome)).toStrictEqual([[890, 894, 891, 892]])
	})

	it('inserts after the target', () => {
		const outcome = git_epic_chains.insert_children(LINEAR, [894], { kind: 'after', target: 891 })

		expect(chains_of(outcome)).toStrictEqual([[890, 891, 894, 892]])
	})

	it('inserts several children in the order given', () => {
		const outcome = git_epic_chains.insert_children(LINEAR, [894, 895], {
			kind: 'before',
			target: 892,
		})

		expect(chains_of(outcome)).toStrictEqual([[890, 891, 894, 895, 892]])
	})
})

describe('git_epic_chains.insert_children — an unordered batch', () => {
	it('stays unordered when no position is given', () => {
		expect(chains_of(git_epic_chains.insert_children([], [894], undefined))).toStrictEqual([])
	})

	it('starts a chain when given a position', () => {
		const outcome = git_epic_chains.insert_children([], [894], { kind: 'before', target: 891 })

		expect(chains_of(outcome)).toStrictEqual([[894, 891]])
	})
})

describe('git_epic_chains.insert_children — several chains', () => {
	it('touches only the chain that names the target', () => {
		const outcome = git_epic_chains.insert_children(
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
	it('refuses a target no chain names', () => {
		const outcome = git_epic_chains.insert_children(LINEAR, [894], { kind: 'before', target: 999 })

		expect(error_of(outcome)).toContain('#999 is not named in the declared dependency order')
	})

	it('refuses a target that appears in more than one chain', () => {
		const outcome = git_epic_chains.insert_children(
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
		const outcome = git_epic_chains.insert_children([[1, 2, 1]], [9], undefined)

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
		const after = chains_of(
			git_epic_chains.insert_children(LINEAR, [894], { kind: 'before', target: 891 }),
		)
		const diff = git_epic_chains.diff_links(LINEAR, after)

		expect(diff.added).toStrictEqual([
			{ blocker: 890, blocked: 894 },
			{ blocker: 894, blocked: 891 },
		])
		expect(diff.removed).toStrictEqual([{ blocker: 890, blocked: 891 }])
	})

	it('removes nothing when the child is appended to the end', () => {
		const after = chains_of(git_epic_chains.insert_children(LINEAR, [894], undefined))
		const diff = git_epic_chains.diff_links(LINEAR, after)

		expect(diff.added).toStrictEqual([{ blocker: 892, blocked: 894 }])
		expect(diff.removed).toStrictEqual([])
	})

	it('inserting at the head of a chain removes nothing', () => {
		const after = chains_of(
			git_epic_chains.insert_children(LINEAR, [894], { kind: 'before', target: 890 }),
		)

		expect(git_epic_chains.diff_links(LINEAR, after).removed).toStrictEqual([])
	})
})

describe('git_epic_chains.insert_children — the result is checked too', () => {
	it('refuses an addition the chain already names', () => {
		const outcome = git_epic_chains.insert_children(LINEAR, [891], undefined)

		expect(error_of(outcome)).toContain('#891 is already named in the declared dependency order')
	})

	it('refuses a positioned addition the chain already names', () => {
		const outcome = git_epic_chains.insert_children(LINEAR, [892], {
			kind: 'before',
			target: 891,
		})

		expect(error_of(outcome)).toContain('would have it block itself')
	})
})
