import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { run_wake_handoff, type WakeSession } from './run-wake-handoff'

// joshuafolkken/kit#5743. The supervisor adopts the record for the session it is about to wake and
// moves the owner to the launched process, so the session counts without a `run:carry --resume`.

const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-wake-handoff-'))
const TARGET = path.join(TEMPORARY, 'carry.json')
const INVOCATION = 'backlogrun --max 5'
// A pid no process holds, so the recorded owner reads as dead.
const DEAD_OWNER = { pid: 2_147_483_646, start: 'gone' }
const SUCCESSOR = { pid: process.pid, start: undefined }
const SESSION: WakeSession = { worktree: TEMPORARY, session_id: 'sid-1', provider: 'anthropic' }
const CODEX_SESSION: WakeSession = { ...SESSION, provider: 'openai' }
const TRANSCRIPT = path.join(cost_transcript.transcript_directory(TEMPORARY), 'sid-1.jsonl')

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
		scheduler_provider: 'openai',
		...overrides,
	}
}

function read_back(): RunCarry {
	const read = run_carry.read_carry(TARGET)

	if (read.kind !== 'carried') throw new Error(`expected a carried record, read ${read.kind}`)

	return read.carry
}

function hand_off_and_on(session: WakeSession, pid: number): void {
	const owner = run_wake_handoff.session_owner(session)

	run_wake_handoff.hand_to(TARGET, owner)
	run_wake_handoff.hand_on(TARGET, owner, pid)
}

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

beforeEach(() => {
	rmSync(TARGET, { force: true })
})

describe('run_wake_handoff.session_owner', () => {
	it('names the transcript the forced session id writes', () => {
		expect(run_wake_handoff.session_owner(SESSION)).toStrictEqual({
			transcript: TRANSCRIPT,
			is_headless: true,
		})
	})

	it('names no transcript for a Codex session, whose id cannot be forced', () => {
		expect(run_wake_handoff.session_owner(CODEX_SESSION)).toStrictEqual({ is_headless: true })
	})
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

describe('run_wake_handoff.hand_to', () => {
	it('adopts the record for the session, keeping its counters and scheduler', () => {
		stamp_file.write_stamp(TARGET, carry({ is_handed_off: true }))

		run_wake_handoff.hand_to(TARGET, run_wake_handoff.session_owner(SESSION))

		expect(read_back()).toMatchObject({
			is_handed_off: false,
			owner_transcript: TRANSCRIPT,
			is_owner_headless: true,
			scheduler_provider: 'openai',
			merged: 1,
			cuts: 1,
		})
	})

	it('adopts nothing where there is no record', () => {
		run_wake_handoff.hand_to(TARGET, run_wake_handoff.session_owner(SESSION))

		expect(run_carry.read_carry(TARGET).kind).toBe('none')
	})
})

describe('run_wake_handoff.has_session_begun', () => {
	it('reads a session whose named transcript is not yet written as not begun', () => {
		expect(run_wake_handoff.has_session_begun(carry({ owner_transcript: TRANSCRIPT }))).toBe(false)
	})

	it('reads a session as begun once its transcript is written', () => {
		mkdirSync(path.dirname(TRANSCRIPT), { recursive: true })
		writeFileSync(TRANSCRIPT, '')

		expect(run_wake_handoff.has_session_begun(carry({ owner_transcript: TRANSCRIPT }))).toBe(true)
		rmSync(TRANSCRIPT)
	})

	it('reads an owner with no transcript to wait for as begun', () => {
		expect(run_wake_handoff.has_session_begun(carry())).toBe(true)
	})
})

describe('run_wake_handoff.hand_on', () => {
	it('moves the owner to the launched process, which reads as a session at work', () => {
		stamp_file.write_stamp(TARGET, carry())

		hand_off_and_on(SESSION, process.ppid)

		expect(read_back()).toMatchObject({ owner_pid: process.ppid, owner_transcript: TRANSCRIPT })
		expect(run_carry.is_held_by_another(read_back())).toBe(true)
	})

	it('lets the session count as the record owner by its transcript alone', () => {
		stamp_file.write_stamp(TARGET, carry())

		hand_off_and_on(SESSION, process.ppid)

		expect(run_carry.is_count_refused(read_back(), { transcript: TRANSCRIPT })).toBe(false)
	})

	it('leaves a Codex session pid-less, so its own counts are not a foreign owner', () => {
		stamp_file.write_stamp(TARGET, carry())

		hand_off_and_on(CODEX_SESSION, process.ppid)

		expect(read_back().owner_pid).toBeUndefined()
		expect(run_carry.is_count_refused(read_back(), run_carry.NO_OWNER)).toBe(false)
	})
})
