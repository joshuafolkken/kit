import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { run_carry, type RunCarry } from './run-carry'
import { run_carry_added } from './run-carry-added'

// joshuafolkken/kit#3433: `run:add` puts an issue into a live `--only` run without touching the
// invocation the ownership comparison reads, and `remaining_of` folds it into the named list.

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-added-test-'))
const NAMED_ONLY_INVOCATION = 'backlogrun #1762 #1749 --only'
const START = new Date('2026-09-10T00:00:00.000Z')
const WITHIN_BOUND = new Date('2026-09-10T01:00:00.000Z')

function target(): string {
	return run_carry.carry_path(path.join(scratch, 'repository.git'))
}

function named_run(): RunCarry {
	run_carry.end_carry(target())

	const carry = run_carry.begin_carry(target(), NAMED_ONLY_INVOCATION, run_carry.NO_OWNER, START)

	if (carry === undefined) throw new Error('the scratch record was not created')

	return carry
}

function added_run(): RunCarry {
	return run_carry_added.add_issues(target(), named_run(), [
		{ issue: 3432, is_priority: true },
		{ issue: 3433, is_priority: true },
		{ issue: 3434, is_priority: false },
	])
}

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('the issues run:add put into a --only run', () => {
	it('come first in the order added, and the appended ones last', () => {
		expect(run_carry.remaining_of(added_run())).toStrictEqual([3432, 3433, 1762, 1749, 3434])
	})

	it('leave the invocation untouched, so the ownership comparison still matches', () => {
		expect(added_run().invocation).toBe(NAMED_ONLY_INVOCATION)
	})

	it('are written to the record a resumed session reads back', () => {
		added_run()
		const read = run_carry.read_carry(target(), WITHIN_BOUND)

		expect(read.kind === 'carried' ? run_carry.remaining_of(read.carry) : []).toStrictEqual([
			3432, 3433, 1762, 1749, 3434,
		])
	})

	it('drop out of the remaining list once done', () => {
		const carry = run_carry.apply_change(target(), added_run(), { done: 3432 })

		expect(run_carry.remaining_of(carry)).toStrictEqual([3433, 1762, 1749, 3434])
	})

	it('keep their first position when added again', () => {
		const again = run_carry_added.add_issues(target(), added_run(), [
			{ issue: 3434, is_priority: true },
		])

		expect(run_carry.remaining_of(again)?.at(-1)).toBe(3434)
	})

	it('do not list a declared issue twice', () => {
		const carry = run_carry_added.add_issues(target(), named_run(), [
			{ issue: 1749, is_priority: true },
		])

		expect(run_carry.remaining_of(carry)).toStrictEqual([1749, 1762])
	})
})
