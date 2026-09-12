import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { time_hook_transcript } from '#scripts/time/time-hook-transcript'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delegation_policy } from './delegation-policy'
import {
	deny_envelope,
	DISABLED_VALUES,
	investigation_refusal,
	is_enabled,
	refusal_path,
	SWITCH_ENV_KEY,
} from './investigation-guard'
import { investigation_reads } from './investigation-reads'

// joshuafolkken/kit#1460: the hook half. What is pinned here is that the refusal reaches the model at
// all, that it happens once per accumulation, and that a delegation re-arms it — the three properties
// that make the threshold fire more than once in a run.

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'investigation-guard-'))
const WRITTEN_TRANSCRIPTS: Array<string> = []
const { BRANCH, call_line, result_line, ms, target_turn_lines } = time_transcript_fixture

const BELOW_THRESHOLD = delegation_policy.INVESTIGATION_FILE_THRESHOLD - 1
const NOW_MS = ms(59)
const EARLIER_REFUSAL_MS = ms(9)
const DELEGATION_MINUTE = 20
const DELEGATION_END_MINUTE = 23
const LATE_TURN = 30
const AGENT_ID = 'agent-call'
const AGENT_NAME = 'unit-1'
const NEXT_FILE = 'scripts/next.ts'
const LONE_FILE = 'scripts/only.ts'
const READ_TOOL = 'Read'
// "Unset" is spelled as the empty string rather than by deleting the key, exactly as
// `batch-guard.test.ts` does: a dynamic `delete` is banned here, and an empty value takes the
// identical path through the switch — it is not one of the recognized disabling spellings.
const UNSET = ''

function subject_files(prefix: string): Array<string> {
	return Array.from(
		{ length: BELOW_THRESHOLD },
		(_unused, index) => `scripts/${prefix}-${String(index)}.ts`,
	)
}

function at_threshold_lines(): Array<string> {
	return target_turn_lines(0, subject_files('read'))
}

function delegated_lines(): Array<string> {
	return [
		call_line(DELEGATION_MINUTE, BRANCH, 'Agent', AGENT_ID),
		result_line(DELEGATION_END_MINUTE, BRANCH, AGENT_ID),
		...target_turn_lines(LATE_TURN, subject_files('late')),
	]
}

function write_transcript(name: string, lines: ReadonlyArray<string>): string {
	const target = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(target, lines.join('\n'))
	WRITTEN_TRANSCRIPTS.push(target)

	return target
}

function payload_of(transcript_path: string, overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path,
		tool_name: READ_TOOL,
		tool_input: { file_path: NEXT_FILE },
		...overrides,
	})
}

// The switch is assigned rather than deleted, so a value left in the real environment cannot decide
// what these cases see.
beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = UNSET
})

afterAll(() => {
	for (const transcript of WRITTEN_TRANSCRIPTS) rmSync(refusal_path(transcript), { force: true })

	rmSync(WORK_DIRECTORY, { force: true, recursive: true })
})

describe('investigation_refusal — the threshold, and its second firing', () => {
	it('refuses the read that reaches the threshold', () => {
		const transcript = write_transcript('at-threshold', at_threshold_lines())

		expect(investigation_refusal(payload_of(transcript), NOW_MS)).toBe(investigation_reads.REASON)
	})

	// One refusal per accumulation. Without this the same call is refused on every look and the run is
	// wedged on the one file it needs.
	it('refuses the same accumulation only once', () => {
		const transcript = write_transcript('once', at_threshold_lines())

		expect(investigation_refusal(payload_of(transcript), NOW_MS)).toBeDefined()
		expect(investigation_refusal(payload_of(transcript), NOW_MS)).toBeUndefined()
	})

	// The whole of the Issue: a delegation clears the count, three more unedited files rebuild it, and
	// the refusal fires a second time.
	it('refuses again after a delegation has reset the count', () => {
		const transcript = write_transcript('rearmed', [...at_threshold_lines(), ...delegated_lines()])

		expect(investigation_refusal(payload_of(transcript), EARLIER_REFUSAL_MS)).toBeDefined()
		expect(investigation_refusal(payload_of(transcript), NOW_MS)).toBeDefined()
	})

	// joshuafolkken/kit#1764: the disarm is per accumulation, and a run that ignores its one refusal
	// goes on accumulating. Until this arm existed only a delegation cleared it, so the one run the
	// threshold exists for — one that reads on and never delegates — was never spoken to twice.
	it('refuses again once another accumulation has piled up without a delegation', () => {
		const transcript = write_transcript('second-accumulation', [
			...at_threshold_lines(),
			...target_turn_lines(LATE_TURN, subject_files('late')),
		])

		expect(investigation_refusal(payload_of(transcript), EARLIER_REFUSAL_MS)).toBeDefined()
		expect(investigation_refusal(payload_of(transcript), NOW_MS)).toBeDefined()
	})

	it('says nothing below the threshold', () => {
		const transcript = write_transcript('below', target_turn_lines(0, [LONE_FILE]))

		expect(investigation_refusal(payload_of(transcript), NOW_MS)).toBeUndefined()
	})
})

describe('investigation_refusal — every failure allows the call', () => {
	it('says nothing for a call that could never be refused', () => {
		const transcript = write_transcript('write-call', at_threshold_lines())
		const overrides = { tool_name: 'Bash', tool_input: { command: 'pnpm josh gate' } }

		expect(investigation_refusal(payload_of(transcript, overrides), NOW_MS)).toBeUndefined()
	})

	it('says nothing when the payload is not JSON', () => {
		expect(investigation_refusal('not json', NOW_MS)).toBeUndefined()
	})

	it('says nothing when the transcript is not there', () => {
		const missing = path.join(WORK_DIRECTORY, 'absent.jsonl')

		expect(investigation_refusal(payload_of(missing), NOW_MS)).toBeUndefined()
	})

	it('says nothing when the switch is off', () => {
		const transcript = write_transcript('switched-off', at_threshold_lines())

		process.env[SWITCH_ENV_KEY] = DISABLED_VALUES[0] ?? 'off'

		expect(investigation_refusal(payload_of(transcript), NOW_MS)).toBeUndefined()
	})
})

describe('investigation_refusal — a delegated unit is judged on its own history', () => {
	// A hook firing inside a unit is handed the *parent's* transcript path, so a guard that judged that
	// file would count the parent's frozen history and never the unit's own reading
	// (joshuafolkken/kit#1424).
	it('judges the fork history, and records against the fork path', () => {
		const parent = write_transcript('parent', target_turn_lines(0, [LONE_FILE]))
		const fork = time_hook_transcript.fork_path(parent, AGENT_NAME)

		mkdirSync(path.dirname(fork), { recursive: true })
		writeFileSync(fork, at_threshold_lines().join('\n'))
		WRITTEN_TRANSCRIPTS.push(fork)

		expect(
			investigation_refusal(payload_of(parent, { agent_id: AGENT_NAME }), NOW_MS),
		).toBeDefined()
		expect(existsSync(refusal_path(fork))).toBe(true)
		expect(existsSync(refusal_path(parent))).toBe(false)
	})

	// joshuafolkken/kit#1764: a unit is already where the reading is sent, and a read-only one has no
	// `Agent` tool to dispatch with — so the accumulation arm would toll that tier one round trip per
	// threshold's worth of files for an instruction it cannot carry out. Its one refusal stands; the
	// repetition does not.
	it('does not re-arm on a second accumulation inside a unit', () => {
		const parent = write_transcript('unit-parent', target_turn_lines(0, [LONE_FILE]))
		const fork = time_hook_transcript.fork_path(parent, 'unit-2')

		mkdirSync(path.dirname(fork), { recursive: true })
		writeFileSync(
			fork,
			[...at_threshold_lines(), ...target_turn_lines(LATE_TURN, subject_files('late'))].join('\n'),
		)
		WRITTEN_TRANSCRIPTS.push(fork)

		const unit_payload = payload_of(parent, { agent_id: 'unit-2' })

		expect(investigation_refusal(unit_payload, EARLIER_REFUSAL_MS)).toBeDefined()
		expect(investigation_refusal(unit_payload, NOW_MS)).toBeUndefined()
	})
})

describe('the guard is adopted without configuring anything', () => {
	it('is on when the variable is unset', () => {
		process.env[SWITCH_ENV_KEY] = UNSET

		expect(is_enabled()).toBe(true)
	})

	it('names a switch of its own, so it is not the batching guard', () => {
		expect(SWITCH_ENV_KEY).toBe('JOSH_INVESTIGATION_GUARD')
	})

	it('answers in the shape that stops a call', () => {
		expect(JSON.parse(deny_envelope(investigation_reads.REASON))).toMatchObject({
			hookSpecificOutput: { permissionDecision: 'deny' },
		})
	})
})
