import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_wake_handoff } from '#scripts/run/wake/run-wake-handoff'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { run_carry, type RunCarry } from './run-carry'
import { run_carry_added } from './run-carry-added'

// joshuafolkken/kit#3697: a rewrite of the carry record never removes it first. `backlog:drive` and
// the supervisor read the record from other processes, and a reader that lands between an unlink and
// the create that follows it is told there is no run.

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-atomic-test-'))
const TARGET = run_carry.carry_path(path.join(scratch, 'repository.git'))

type Rewrite = (carry: RunCarry) => void

const REWRITES: ReadonlyArray<readonly [string, Rewrite]> = [
	['a count', (carry) => run_carry.apply_change(TARGET, carry, { merged: 1, merged_issue: 3697 })],
	['an added issue', (carry) => run_carry_added.add_issues(TARGET, carry, [])],
	[
		'the recovery hand-off',
		() => {
			run_wake_handoff.hand_off(TARGET)
		},
	],
]

function fresh_run(): RunCarry {
	run_carry.end_carry(TARGET)

	const carry = run_carry.begin_carry(TARGET, 'backlogrun', run_carry.NO_OWNER)

	if (carry === undefined) throw new Error('the scratch record was not created')

	return carry
}

afterEach(() => {
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

it.each(REWRITES)('rewrites the record for %s without removing it first', (_name, rewrite) => {
	const carry = fresh_run()
	const unlinking_write = vi.spyOn(stamp_file, 'write_stamp')
	const replace = vi.spyOn(stamp_file, 'replace_stamp')

	rewrite(carry)

	expect(unlinking_write).not.toHaveBeenCalled()
	expect(replace).toHaveBeenCalledOnce()
	expect(run_carry.read_carry(TARGET).kind).toBe('carried')
})
