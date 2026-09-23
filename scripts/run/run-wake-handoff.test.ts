import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { run_carry, type RunCarry } from './run-carry'
import { run_wake_handoff } from './run-wake-handoff'

// joshuafolkken/kit#2437. The supervisor recovers a record whose owner died by handing it off first, so
// the woken successor's `--begin` answers `resume` rather than `standing`.

const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-wake-handoff-'))
const TARGET = path.join(TEMPORARY, 'carry.json')
const INVOCATION = 'backlogrun --max 5'
// A pid no process holds, so the recorded owner reads as dead.
const DEAD_OWNER = { pid: 2_147_483_646, start: 'gone' }
const SUCCESSOR = { pid: process.pid, start: undefined }

function carry(overrides: Partial<RunCarry> = {}): RunCarry {
	return {
		invocation: INVOCATION,
		started_at: new Date().toISOString(),
		merged: 1,
		filed: 0,
		cuts: 1,
		failures: 0,
		outages: 0,
		owner_pid: DEAD_OWNER.pid,
		owner_start: DEAD_OWNER.start,
		...overrides,
	}
}

function read_back(): RunCarry {
	const read = run_carry.read_carry(TARGET)

	if (read.kind !== 'carried') throw new Error(`expected a carried record, read ${read.kind}`)

	return read.carry
}

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

beforeEach(() => {
	rmSync(TARGET, { force: true })
})

describe('run_wake_handoff.hand_off', () => {
	it('hands off a record no cut handed off, keeping its counters', () => {
		stamp_file.write_stamp(TARGET, carry())

		run_wake_handoff.hand_off(TARGET)

		expect(read_back()).toMatchObject({ is_handed_off: true, merged: 1, cuts: 1 })
	})

	it('makes the successor begin as resumed rather than standing', () => {
		stamp_file.write_stamp(TARGET, carry())
		const request = { invocation: INVOCATION, owner: SUCCESSOR, is_adoption: false }

		expect(run_carry.classify_claim(read_back(), request)).toBe('standing')

		run_wake_handoff.hand_off(TARGET)

		expect(run_carry.classify_claim(read_back(), request)).toBe('resume')
	})

	it('writes nothing where there is no record', () => {
		run_wake_handoff.hand_off(TARGET)

		expect(run_carry.read_carry(TARGET).kind).toBe('none')
	})
})
