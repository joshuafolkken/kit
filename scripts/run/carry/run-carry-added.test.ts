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

describe('explicit retry', () => {
	it('retries only the requested issue while preserving counts, ownership and other completions', () => {
		const carry = {
			...named_run(),
			done: [1749, 1762],
			merged: 1,
			merged_issues: [1762],
			filed: 1,
			owner_pid: 123,
			lane_limit: 1,
		}
		const retried = run_carry_added.add_issues(
			target(),
			carry,
			[{ issue: 1749, is_priority: true }],
			[1749],
		)

		expect(retried).toStrictEqual({
			...carry,
			done: [1762],
			added: [{ issue: 1749, is_priority: true }],
		})
		const read = run_carry.read_carry(target())

		expect(read.kind === 'carried' ? run_carry.remaining_of(read.carry) : []).toStrictEqual([1749])
	})
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
		const read = run_carry.read_carry(target())

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
