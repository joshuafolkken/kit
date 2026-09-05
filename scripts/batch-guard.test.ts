import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
	batch_refusal,
	deny_envelope,
	DISABLED_VALUES,
	is_enabled,
	load_environment_file,
	refusal_path,
	SWITCH_ENV_KEY,
} from './batch-guard'
import { time_hook_transcript } from './time/time-hook-transcript'
import { time_transcript_fixture } from './time/time-transcript-fixture'

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'batch-guard-'))
const { open_turn_lines, target_turn_lines, ms } = time_transcript_fixture
// A minute of the fixture day that is past every turn below. The recorded instant is compared against
// the transcript's own timestamps, so a `Date.now()`-shaped constant taken from a different year would
// make the record read as older than the sequence it was written for.
const FRESH_PATH = 'scripts/fresh.ts'
const LATER_MINUTE = 59
const NOW_MS = ms(LATER_MINUTE)
// The shape Claude Code puts in a forked agent's payload: the id of the fork, beside the *parent*
// session's transcript path (joshuafolkken/kit#1424).
const AGENT_ID = 'a313eea340918b8a1'

// A transcript of its own per case, so one case's refusal record never silences another's — the record
// is keyed on the transcript the payload names. Each is remembered rather than listed again in the
// teardown: the records land in the shared temp directory, not under `WORK_DIRECTORY`.
const WRITTEN_TRANSCRIPTS = new Set<string>()

// Three consecutive single-call turns' worth of history with the third turn still open, which is the
// one shape the guard refuses.
function unbatched_text(): string {
	return [
		...target_turn_lines(0, ['a.ts']),
		...target_turn_lines(1, ['b.ts']),
		...open_turn_lines(2, ['c.ts']),
	].join('\n')
}

// A run that already batched, which the guard has nothing to say about. Used both as a case of its own
// and as the *parent* half of the fork cases, where it is what proves the fork's own file was read.
function batched_text(): string {
	return [
		...target_turn_lines(0, ['a.ts']),
		...target_turn_lines(1, ['b.ts', 'e.ts']),
		...target_turn_lines(2, ['f.ts']),
		...open_turn_lines(3, ['c.ts']),
	].join('\n')
}

function write_transcript(name: string, text: string): string {
	const target = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(target, text)
	WRITTEN_TRANSCRIPTS.add(target)

	return target
}

function payload_of(name: string, text: string = unbatched_text()): string {
	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: write_transcript(name, text),
		tool_name: 'Read',
		tool_input: { file_path: FRESH_PATH },
	})
}

// A payload as a forked agent's call arrives: `transcript_path` naming the parent — whose history says
// nothing — and `agent_id` naming the fork, whose own history is a run of single-call turns. **Where
// the fork's file goes comes from the module that resolves it**, so this suite cannot drift from the
// layout Claude Code writes; `time-hook-transcript.test.ts` is what pins that layout literally.
function fork_payload_of(name: string, agent_id: string = AGENT_ID): string {
	const session_path = write_transcript(name, batched_text())
	const fork = time_hook_transcript.fork_path(session_path, agent_id)

	mkdirSync(path.dirname(fork), { recursive: true })
	writeFileSync(fork, unbatched_text())
	WRITTEN_TRANSCRIPTS.add(fork)

	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: session_path,
		agent_id,
		tool_name: 'Read',
		tool_input: { file_path: FRESH_PATH },
	})
}

// **Before rather than after each case**: an `afterEach` leaves the *first* case reading whatever the
// developer exported, and this switch's safe state is on — so a shell with it set to `off` would have
// turned the suite green on a guard that never fired. Assigned rather than deleted, because an empty
// value is not one the disabled list recognizes: the guard reads as on, exactly as it does on a machine
// that has never heard of the variable.
beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
})

afterAll(() => {
	for (const transcript of WRITTEN_TRANSCRIPTS) rmSync(refusal_path(transcript), { force: true })

	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

describe('batch_refusal', () => {
	it('refuses the third consecutive single-call turn', () => {
		const reason = batch_refusal(payload_of('unbatched'), NOW_MS)

		expect(reason).toContain('batching')
	})

	// The second look at the same run of single-call turns. Nothing has batched in between, so the
	// sequence the first refusal recorded is still the open one — and refusing it again is the loop the
	// record exists to make impossible.
	it('refuses the same sequence only once', () => {
		const payload = payload_of('twice')

		expect(batch_refusal(payload, NOW_MS)).toBeDefined()
		expect(batch_refusal(payload, NOW_MS)).toBeUndefined()
	})

	// A turn that already batched breaks the run of singles, so what precedes it is not carried across.
	it('says nothing where a batched turn broke the run of singles', () => {
		const payload = payload_of('batched', batched_text())

		expect(batch_refusal(payload, NOW_MS)).toBeUndefined()
	})

	// Every failure allows the call: a hook that failed closed would stop a run over its own plumbing.
	it('says nothing when the payload is not JSON', () => {
		expect(batch_refusal('not json', NOW_MS)).toBeUndefined()
	})

	it('says nothing when the transcript is not there', () => {
		const payload = JSON.stringify({
			transcript_path: path.join(WORK_DIRECTORY, 'no-such-session.jsonl'),
			tool_name: 'Read',
			tool_input: { file_path: FRESH_PATH },
		})

		expect(batch_refusal(payload, NOW_MS)).toBeUndefined()
	})

	it('says nothing when the switch is off', () => {
		process.env[SWITCH_ENV_KEY] = DISABLED_VALUES[0] ?? 'off'

		expect(batch_refusal(payload_of('switched-off'), NOW_MS)).toBeUndefined()
	})
})

// A forked review agent's calls were never judged before this (joshuafolkken/kit#1424): the payload
// names the parent session, whose timeline is frozen for as long as the fork runs, so the guard
// refused nothing at all in 551 measured forks.
describe('batch_refusal — a forked agent is judged on its own transcript', () => {
	it("refuses on the fork's history where the parent's says nothing", () => {
		expect(batch_refusal(fork_payload_of('fork-judged'), NOW_MS)).toContain('batching')
	})

	// The record has always been described as giving a delegated unit a budget of its own. It only does
	// once it is keyed on the fork's path — keyed on the parent's, one fork's refusal would silence the
	// next fork of the same session.
	it("records the refusal against the fork's own path", () => {
		const payload = fork_payload_of('fork-record')
		const { transcript_path } = JSON.parse(payload) as { transcript_path: string }
		const fork = time_hook_transcript.fork_path(transcript_path, AGENT_ID)

		expect(batch_refusal(payload, NOW_MS)).toBeDefined()
		expect(existsSync(refusal_path(fork))).toBe(true)
		expect(existsSync(refusal_path(transcript_path))).toBe(false)
	})

	// **The fork's first call, before anything has been written under it — and the parent's own history
	// must not answer for it.** A parent is often mid-streak exactly when it delegates, so judging on its
	// tail would refuse a fork that has run nothing at all *and* spend the parent's record, admitting the
	// parent's next genuine third single-call turn in silence.
	it("says nothing, and spends nothing, when the fork's transcript is not there yet", () => {
		const session_path = write_transcript('fork-absent', unbatched_text())
		const payload = JSON.stringify({
			hook_event_name: 'PreToolUse',
			transcript_path: session_path,
			agent_id: AGENT_ID,
			tool_name: 'Read',
			tool_input: { file_path: FRESH_PATH },
		})

		expect(batch_refusal(payload, NOW_MS)).toBeUndefined()
		expect(existsSync(refusal_path(session_path))).toBe(false)
	})

	// A main line that spells its absent agent `null` is a main line, not a fork. Rejected by the schema
	// instead, the whole payload would fail to parse and the guard would go silent on every call.
	it('judges the session itself when the agent is spelled null', () => {
		const payload = time_transcript_fixture.with_null_agent(payload_of('null-agent'))

		expect(batch_refusal(payload, NOW_MS)).toContain('batching')
	})
})

describe('is_enabled', () => {
	it('is on when the variable is unset, so the guard costs nothing to adopt', () => {
		expect(is_enabled()).toBe(true)
	})

	it.each([...DISABLED_VALUES])('is off for %s', (value) => {
		process.env[SWITCH_ENV_KEY] = value

		expect(is_enabled()).toBe(false)
	})

	// A value meant to disable the guard that the list does not recognize leaves it on, which is the
	// failure the caller can see — refusals they asked to stop — rather than a silent one.
	it('is on for a value the list does not recognize', () => {
		process.env[SWITCH_ENV_KEY] = 'disable'

		expect(is_enabled()).toBe(true)
	})
})

// It runs on the real hook path before anything is read, so the one thing that must be true of it is
// that a project without a `.env` costs nothing and raises nothing.
describe('load_environment_file', () => {
	it('does not throw where there is no env file to load', () => {
		expect(() => {
			load_environment_file()
		}).not.toThrow()
	})
})

describe('deny_envelope', () => {
	// Plain stdout does not stop a call; only this shape does, and only the reason field reaches the
	// model.
	it('names the PreToolUse deny decision and carries the reason', () => {
		const envelope: unknown = JSON.parse(deny_envelope('because'))

		expect(envelope).toEqual({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
				permissionDecisionReason: 'because',
			},
		})
	})
})
