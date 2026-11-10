import { existsSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lint_shard } from './lint-shard'

const { FIRST_SHARD_DIRECTORIES, WHOLE_TREE } = lint_shard

describe('lint_shard.shard_of', () => {
	it('reads no shard when the arguments name none', () => {
		expect(lint_shard.shard_of(['--changed'])).toBeUndefined()
	})

	it.each([
		['--shard=1', 1],
		['--shard=2', 2],
	])('reads %s as shard %i', (flag, shard) => {
		expect(lint_shard.shard_of(['--changed', flag])).toBe(shard)
	})

	it.each(['--shard=0', '--shard=3', '--shard=', '--shard=one'])('refuses %s', (flag) => {
		expect(() => lint_shard.shard_of([flag])).toThrow(/unknown shard/u)
	})
})

// joshuafolkken/kit#6997: the two shards together are `eslint .` — shard 2 is the whole tree with
// exactly the directories shard 1 names ignored.
describe('lint_shard.eslint_targets', () => {
	it('points a run with no shard at the whole tree', () => {
		expect(lint_shard.eslint_targets(undefined)).toEqual([WHOLE_TREE])
	})

	it('points shard 1 at its directories', () => {
		expect(lint_shard.eslint_targets(1)).toEqual(FIRST_SHARD_DIRECTORIES)
	})

	it('points shard 2 at the whole tree less every shard 1 directory', () => {
		const ignored = FIRST_SHARD_DIRECTORIES.map((directory) => `${directory}/`)
		const targets = lint_shard.eslint_targets(2)

		expect(targets[0]).toBe(WHOLE_TREE)
		expect(targets.filter((target) => target !== '--ignore-pattern').slice(1)).toEqual(ignored)
	})

	// eslint refuses a directory argument that does not exist, so a moved directory fails shard 1.
	it.each(FIRST_SHARD_DIRECTORIES)('names %s, a directory of this repository', (directory) => {
		expect(existsSync(directory) && statSync(directory).isDirectory()).toBe(true)
	})
})

describe('lint_shard formatting and description', () => {
	it.each([
		[undefined, true],
		[1, true],
		[2, false],
	] as const)('checks formatting in shard %s: %s', (shard, expected) => {
		expect(lint_shard.checks_formatting(shard)).toBe(expected)
	})

	it('describes a shard and adds nothing for the whole tree', () => {
		expect(lint_shard.describe(2)).toBe(' · shard 2 of 2')
		expect(lint_shard.describe(undefined)).toBe('')
	})
})
