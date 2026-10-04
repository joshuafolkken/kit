import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { afterAll, describe, expect, it } from 'vitest'
import { run_carry, type RunCarry } from './run-carry'
import { run_carry_conversation } from './run-carry-conversation'

// joshuafolkken/kit#3137: an interactive conversation outlives its process — a restart resumes it in a
// new one, writing on into the same transcript — so the carry record's owner is the conversation as
// well as the pid. These pin the transcript half: where it is found, when it reads as continuing, and
// how a resumed conversation takes the record's owner back.

const { DEAD_PID } = process_identity_fixture
const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-conversation-test-'))
const EMPTY_DIRECTORY = path.join(scratch, 'empty')
const PROJECT_DIRECTORY = path.join(scratch, 'project')
const SESSION_ID = 'conversation-3137'
const TRANSCRIPT = path.join(PROJECT_DIRECTORY, `${SESSION_ID}.jsonl`)
const NOW = new Date('2026-10-04T15:18:00.000Z')
const JUST_WRITTEN = NOW.getTime() - 18_000
const LONG_QUIET = NOW.getTime() - run_carry_conversation.CONVERSATION_QUIET_MS - 1
const OLD_PID = 42_157
const NEW_PID = 55_250

mkdirSync(EMPTY_DIRECTORY)
mkdirSync(PROJECT_DIRECTORY)
writeFileSync(TRANSCRIPT, '{}\n')

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function record(overrides: Partial<RunCarry> = {}): RunCarry {
	return {
		invocation: 'backlogrun #2847',
		started_at: NOW.toISOString(),
		merged: 0,
		filed: 0,
		cuts: 0,
		failures: 0,
		outages: 0,
		owner_pid: OLD_PID,
		owner_start: 'old',
		owner_transcript: TRANSCRIPT,
		...overrides,
	}
}

function modified_at(ms: number | undefined): () => number | undefined {
	return () => ms
}

describe('the calling session’s own transcript', () => {
	it('is found by the session id in the first directory that holds it', () => {
		const environment = { CLAUDE_CODE_SESSION_ID: SESSION_ID }
		const directories = [EMPTY_DIRECTORY, PROJECT_DIRECTORY]

		expect(run_carry_conversation.own_transcript(environment, directories)).toBe(TRANSCRIPT)
	})

	it('is absent outside a session, as in a detached supervisor', () => {
		expect(run_carry_conversation.own_transcript({}, [PROJECT_DIRECTORY])).toBeUndefined()
	})

	it('is absent when no directory holds the session’s file', () => {
		const environment = { CLAUDE_CODE_SESSION_ID: 'another-session' }

		expect(run_carry_conversation.own_transcript(environment, [PROJECT_DIRECTORY])).toBeUndefined()
	})
})

describe('a conversation whose process has gone', () => {
	it('is still continuing while its transcript was written inside the quiet window', () => {
		const is_live = run_carry_conversation.is_conversation_live(
			record(),
			NOW,
			modified_at(JUST_WRITTEN),
		)

		expect(is_live).toBe(true)
	})

	it('has ended once its transcript has been quiet past the window', () => {
		const is_live = run_carry_conversation.is_conversation_live(
			record(),
			NOW,
			modified_at(LONG_QUIET),
		)

		expect(is_live).toBe(false)
	})

	it('has ended for a record a cut handed off, however recently it wrote', () => {
		const handed_off = record({ is_handed_off: true })

		expect(
			run_carry_conversation.is_conversation_live(handed_off, NOW, modified_at(JUST_WRITTEN)),
		).toBe(false)
	})

	it('is not read for a record that names no transcript', () => {
		const unnamed = record({ owner_transcript: undefined })

		expect(
			run_carry_conversation.is_conversation_live(unnamed, NOW, modified_at(JUST_WRITTEN)),
		).toBe(false)
	})

	it('has ended when its transcript cannot be read', () => {
		expect(run_carry_conversation.is_conversation_live(record(), NOW, modified_at(undefined))).toBe(
			false,
		)
	})
})

describe('a resumed conversation taking the record back', () => {
	it('moves the owner to the conversation’s new process', () => {
		const owner = { pid: NEW_PID, start: 'new', transcript: TRANSCRIPT }
		const reclaimed = run_carry_conversation.reclaim_owner(record(), owner)

		expect(reclaimed).toMatchObject({ owner_pid: NEW_PID, owner_start: 'new' })
	})

	it('leaves the owner alone for a caller from another conversation', () => {
		const owner = { pid: NEW_PID, start: 'new', transcript: path.join(scratch, 'other.jsonl') }

		expect(run_carry_conversation.reclaim_owner(record(), owner)).toStrictEqual(record())
	})

	it('leaves a record a cut handed off for its successor', () => {
		const handed_off = record({ is_handed_off: true })
		const owner = { pid: NEW_PID, start: 'new', transcript: TRANSCRIPT }

		expect(run_carry_conversation.reclaim_owner(handed_off, owner)).toStrictEqual(handed_off)
	})

	it('leaves the owner alone for a caller that names no conversation', () => {
		const owner = { pid: NEW_PID, start: 'new' }

		expect(run_carry_conversation.reclaim_owner(record(), owner)).toStrictEqual(record())
	})
})

// The ownership answers `run:wake` and `run:carry` act on, for a record whose pid has died and whose
// transcript was written just now — the state the 2026-10-04 restart left behind.
describe('an owner whose process restarted inside the same conversation', () => {
	const restarted = record({ owner_pid: DEAD_PID, owner_start: undefined })
	const another_session = { pid: process.pid }

	it('reads as live while the conversation goes on', () => {
		expect(run_carry.is_owner_live(restarted)).toBe(true)
	})

	it('refuses another session asking to begin over it', () => {
		const request = { invocation: restarted.invocation, owner: another_session, is_adoption: false }

		expect(run_carry.classify_claim(restarted, request)).toBe('busy')
	})

	it('lets the resumed conversation count from its new process', () => {
		const resumed = { pid: process.pid, transcript: TRANSCRIPT }

		expect(run_carry.is_count_refused(restarted, resumed)).toBe(false)
	})

	it('reads as gone once a cut handed the record off', () => {
		expect(run_carry.is_owner_live({ ...restarted, is_handed_off: true })).toBe(false)
	})

	it('reads as gone once its conversation has been quiet past the window', () => {
		const later = new Date(Date.now() + run_carry_conversation.CONVERSATION_QUIET_MS + 1)

		expect(run_carry.is_owner_live(restarted, later)).toBe(false)
	})
})
