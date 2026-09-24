import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_carry } from '#scripts/run/run-carry'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { backlog_drive_owner } from './backlog-drive-owner'

const INVOCATION = 'backlogrun --idle 0'
const LOST_OWNER = 'no longer owns'
const scratch = { directory: '', target: '' }

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
	run_carry.begin_carry(scratch.target, INVOCATION, run_carry.owner_of(process.pid))

	await expect(backlog_drive_owner.assert_current(String(process.pid))).resolves.toBeUndefined()
})

test('refuses a driver whose owner was replaced on restart', async () => {
	run_carry.begin_carry(scratch.target, INVOCATION, run_carry.NO_OWNER)

	await expect(backlog_drive_owner.assert_current(String(process.pid))).rejects.toThrow(LOST_OWNER)
})

test('refuses a driver after its carry record was handed off', async () => {
	const carry = run_carry.begin_carry(scratch.target, INVOCATION, run_carry.owner_of(process.pid))
	if (carry === undefined) throw new Error('carry not created')
	run_carry.apply_change(scratch.target, carry, { cuts: 1 })

	await expect(backlog_drive_owner.assert_current(String(process.pid))).rejects.toThrow(LOST_OWNER)
})
