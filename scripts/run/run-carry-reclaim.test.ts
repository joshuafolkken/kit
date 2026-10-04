import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { run_carry, type CarryOwner, type RunCarry } from './run-carry'
import { run_carry_conversation } from './run-carry-conversation'
import { run_carry_reclaim } from './run-carry-reclaim'

// joshuafolkken/kit#3137 review: a resumed parent waiting on a lane child counts nothing, so the
// record has to be taken back by the wait itself — otherwise it names the dead process once the
// transcript falls quiet, and `run:wake` recovers it as a crash ten minutes later.

const { DEAD_PID } = process_identity_fixture
const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-reclaim-test-'))
const TARGET = path.join(scratch, 'carry.json')
const TRANSCRIPT = path.join(scratch, 'conversation-3137.jsonl')
const OTHER_TRANSCRIPT = path.join(scratch, 'other.jsonl')
const LONG_QUIET_MS = run_carry_conversation.CONVERSATION_QUIET_MS + 1

writeFileSync(TRANSCRIPT, '{}\n')

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

beforeEach(() => {
	stamp_file.remove_stamp(TARGET)
})

function record(overrides: Partial<RunCarry> = {}): RunCarry {
	return {
		invocation: 'backlogrun #2847',
		started_at: new Date().toISOString(),
		merged: 0,
		filed: 0,
		cuts: 0,
		failures: 0,
		outages: 0,
		owner_pid: DEAD_PID,
		owner_start: 'old',
		owner_transcript: TRANSCRIPT,
		...overrides,
	}
}

function current_owner(transcript: string = TRANSCRIPT): CarryOwner {
	return { pid: process.pid, start: process_identity.read_start(process.pid), transcript }
}

function stored(): RunCarry | undefined {
	const read = run_carry.read_carry(TARGET)

	return read.kind === 'carried' ? read.carry : undefined
}

describe('a resumed conversation reclaiming its record before a wait', () => {
	it('moves the record to the new process, which keeps it live past the quiet window', () => {
		stamp_file.write_stamp(TARGET, record())

		expect(run_carry_reclaim.reclaim_at(TARGET, current_owner())).toBe(true)

		const carry = stored()
		const later = new Date(Date.now() + LONG_QUIET_MS)

		expect(carry).toMatchObject({ owner_pid: process.pid, owner_transcript: TRANSCRIPT })
		expect(carry !== undefined && run_carry.is_owner_live(carry, later)).toBe(true)
	})

	it('leaves a record from another conversation alone', () => {
		stamp_file.write_stamp(TARGET, record())

		expect(run_carry_reclaim.reclaim_at(TARGET, current_owner(OTHER_TRANSCRIPT))).toBe(false)
		expect(stored()).toMatchObject({ owner_pid: DEAD_PID })
	})

	it('leaves a record a cut handed off for its successor', () => {
		stamp_file.write_stamp(TARGET, record({ is_handed_off: true }))

		expect(run_carry_reclaim.reclaim_at(TARGET, current_owner())).toBe(false)
		expect(stored()).toMatchObject({ owner_pid: DEAD_PID, is_handed_off: true })
	})

	it('does nothing when there is no record', () => {
		expect(run_carry_reclaim.reclaim_at(TARGET, current_owner())).toBe(false)
		expect(stored()).toBeUndefined()
	})
})
