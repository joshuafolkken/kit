import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { time_transcript_fixture } from './time/time-transcript-fixture'

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'batch-guard-'))
const { open_turn_lines, target_turn_lines, ms } = time_transcript_fixture
// A minute of the fixture day that is past every turn below. The recorded instant is compared against
// the transcript's own timestamps, so a `Date.now()`-shaped constant taken from a different year would
// make the record read as older than the sequence it was written for.
const FRESH_PATH = 'scripts/fresh.ts'
const LATER_MINUTE = 59
const NOW_MS = ms(LATER_MINUTE)

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
		const batched = [
			...target_turn_lines(0, ['a.ts']),
			...target_turn_lines(1, ['b.ts', 'e.ts']),
			...target_turn_lines(2, ['f.ts']),
			...open_turn_lines(3, ['c.ts']),
		].join('\n')

		expect(batch_refusal(payload_of('batched', batched), NOW_MS)).toBeUndefined()
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
