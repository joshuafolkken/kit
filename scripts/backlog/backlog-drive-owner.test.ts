import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { poll } from '#scripts/lib/poll'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import { backlog_budget } from './backlog-budget'
import { backlog_drive_owner } from './backlog-drive-owner'

const INVOCATION = 'backlogrun --idle 0'
const LOST_OWNER = 'no longer owns'
const OWNER = String(process.pid)
const scratch = { directory: '', target: '' }

function begin(): void {
	run_carry.begin_carry(scratch.target, INVOCATION, run_carry.owner_of(process.pid))
}

function quiet_sleep(): MockInstance<typeof poll.sleep> {
	return vi.spyOn(poll, 'sleep').mockResolvedValue()
}

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'josh-drive-owner-'))
	scratch.target = run_carry.carry_path(scratch.directory)
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(scratch.directory)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(scratch.directory, { recursive: true, force: true })
})

test('allows the live supervisor that owns the carry record', async () => {
	begin()

	await expect(backlog_drive_owner.assert_current(OWNER)).resolves.toMatchObject({
		invocation: INVOCATION,
	})
})

test('refuses a driver whose owner was replaced on restart', async () => {
	run_carry.begin_carry(scratch.target, INVOCATION, run_carry.NO_OWNER)

	await expect(backlog_drive_owner.assert_current(OWNER)).rejects.toThrow(LOST_OWNER)
})

test('refuses a driver after its carry record was handed off', async () => {
	const carry = run_carry.begin_carry(scratch.target, INVOCATION, run_carry.owner_of(process.pid))
	if (carry === undefined) throw new Error('carry not created')
	run_carry.apply_change(scratch.target, carry, { cuts: 1 })

	await expect(backlog_drive_owner.assert_current(OWNER)).rejects.toThrow(LOST_OWNER)
})

// joshuafolkken/kit#3697: one read that failed ended the driver, and with it the idle watch.
describe('backlog_drive_owner.assert_current — a record that does not read', () => {
	test('reads the record again after one failed read, at the offer interval', async () => {
		begin()
		const sleep = quiet_sleep()
		const said = vi.spyOn(console, 'error').mockImplementation(vi.fn())

		vi.spyOn(run_carry, 'read_carry').mockReturnValueOnce({ kind: 'none' })

		await expect(backlog_drive_owner.assert_current(OWNER)).resolves.toMatchObject({
			invocation: INVOCATION,
		})
		expect(sleep.mock.calls).toStrictEqual([[backlog_budget.OFFER_INTERVAL_MS]])
		expect(said).toHaveBeenCalledExactlyOnceWith(
			'The carry record read `none` with its file present; reading it again.',
		)
	})

	test('gives up, saying why, when the record never reads', async () => {
		const sleep = quiet_sleep()

		vi.spyOn(console, 'error').mockImplementation(vi.fn())

		await expect(backlog_drive_owner.assert_current(OWNER)).rejects.toThrow(
			'The carry record read `none` with its file absent, 6 times in a row.',
		)
		expect(sleep).toHaveBeenCalledTimes(backlog_drive_owner.READ_ATTEMPTS - 1)
	})

	test('stops at once on a run that run:carry --end ended', async () => {
		begin()
		await backlog_drive_owner.assert_current(OWNER)
		const sleep = quiet_sleep()
		const ended = run_carry_ended.ended_path(scratch.directory)

		run_carry_ended.record_ended(ended, run_carry.read_carry(scratch.target))
		run_carry.end_carry(scratch.target)

		await expect(backlog_drive_owner.assert_current(OWNER)).rejects.toThrow('no longer active')
		expect(sleep).not.toHaveBeenCalled()
	})
})
