import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, describe, expect, it } from 'vitest'
import { hook_decision, type TranscriptGuard } from './hook-decision'

// joshuafolkken/kit#1460: the shell two refusing `PreToolUse` hooks share. Asserted here rather than
// only through each hook, so a change to the plumbing fails once instead of twice — and so the
// properties each hook's suite depends on are written down where the plumbing is.

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'hook-decision-'))
const SWITCH_KEY = 'JOSH_HOOK_DECISION_TEST_SWITCH'
const OTHER_SWITCH_KEY = 'JOSH_HOOK_DECISION_TEST_OTHER'
const STAMP_PREFIX = 'josh-hook-decision-test-'
const REASON = 'because the count says so'
const NOW_MS = 1_700_000_000_000
const READ_TOOL = 'Read'
// "Unset" is spelled as the empty string rather than by deleting the key, for the reason
// `batch-guard.test.ts` does the same: a dynamic `delete` is banned here, and an empty value takes the
// identical path through the switch — it is not one of the recognized disabling spellings.
const UNSET = ''
const TRANSCRIPT = path.join(WORK_DIRECTORY, 'session.jsonl')
const OTHER_TRANSCRIPT = path.join(WORK_DIRECTORY, 'other.jsonl')
// A path with no file behind it — the routine state a fork's first calls see, which must stay silent.
const MISSING_TRANSCRIPT = path.join(WORK_DIRECTORY, 'absent.jsonl')
// A path that exists but cannot be read as a file, which is a real fault (joshuafolkken/kit#1509).
const UNREADABLE_TRANSCRIPT = path.join(WORK_DIRECTORY, 'unreadable.jsonl')
const BLOCKED_STAMP_PREFIX = 'josh-hook-decision-blocked-'

const STAMP = hook_decision.create_refusal_stamp(STAMP_PREFIX)

function payload_text(transcript_path: string = TRANSCRIPT): string {
	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path,
		tool_name: READ_TOOL,
		tool_input: { file_path: 'scripts/one.ts' },
	})
}

afterAll(() => {
	for (const transcript of [TRANSCRIPT, OTHER_TRANSCRIPT, MISSING_TRANSCRIPT]) {
		rmSync(STAMP.path(transcript), { force: true })
	}

	rmSync(hook_decision.create_refusal_stamp(BLOCKED_STAMP_PREFIX).path(TRANSCRIPT), {
		force: true,
		recursive: true,
	})

	rmSync(WORK_DIRECTORY, { force: true, recursive: true })
})

describe('hook_decision.parse_hook_payload', () => {
	it('reads the four fields a PreToolUse hook is handed', () => {
		expect(hook_decision.parse_hook_payload(payload_text())?.tool_name).toBe(READ_TOOL)
	})

	// A payload spelling the absent agent as `null` has to read as "no fork". Rejected, the whole
	// payload fails and the guard comes off every call of the main line, in silence.
	it('accepts an agent spelled null', () => {
		const raw = time_transcript_fixture.with_null_agent(payload_text())

		expect(hook_decision.parse_hook_payload(raw)?.tool_name).toBe(READ_TOOL)
	})

	it('answers undefined for a payload missing the transcript path', () => {
		const raw = JSON.stringify({ tool_name: READ_TOOL })

		expect(hook_decision.parse_hook_payload(raw)).toBeUndefined()
	})
})

describe('hook_decision.is_switch_enabled', () => {
	it('is on when the variable is unset, so a guard costs nothing to adopt', () => {
		process.env[SWITCH_KEY] = UNSET

		expect(hook_decision.is_switch_enabled(SWITCH_KEY)).toBe(true)
	})

	it.each([...hook_decision.DISABLED_VALUES])('is off for %s', (value) => {
		process.env[SWITCH_KEY] = value

		expect(hook_decision.is_switch_enabled(SWITCH_KEY)).toBe(false)
	})

	it('is on for a value the list does not recognize', () => {
		process.env[SWITCH_KEY] = 'disable'

		expect(hook_decision.is_switch_enabled(SWITCH_KEY)).toBe(true)
	})

	// Each hook names its own variable, so one switched off must leave the other on. Read at call time
	// rather than cached at module load, which is what lets a suite switch it between cases at all.
	it('answers per key, so one guard switched off leaves the other on', () => {
		process.env[SWITCH_KEY] = 'off'
		process.env[OTHER_SWITCH_KEY] = UNSET

		expect(hook_decision.is_switch_enabled(SWITCH_KEY)).toBe(false)
		expect(hook_decision.is_switch_enabled(OTHER_SWITCH_KEY)).toBe(true)
	})
})

describe('hook_decision.deny_envelope', () => {
	// Only this shape stops a call, and only `permissionDecisionReason` reaches the model. Asserted as
	// the exact object: an extra key is a shape Claude Code was not documented to accept.
	it('names the PreToolUse deny decision and carries the reason', () => {
		expect(JSON.parse(hook_decision.deny_envelope(REASON))).toEqual({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
				permissionDecisionReason: REASON,
			},
		})
	})
})

describe('hook_decision.create_refusal_stamp', () => {
	it('answers NEVER_MS before anything has been refused', () => {
		expect(STAMP.last_ms(STAMP.path(OTHER_TRANSCRIPT))).toBe(hook_decision.NEVER_MS)
	})

	it('records an instant and reads it back', () => {
		const target = STAMP.path(TRANSCRIPT)

		expect(STAMP.record(target, NOW_MS)).toBe(true)
		expect(existsSync(target)).toBe(true)
		expect(STAMP.last_ms(target)).toBe(NOW_MS)
	})

	// One record per session, keyed on the transcript: what is tracked is a *run*, and a delegated
	// child is a run of its own.
	it('keys the record on the transcript it was given', () => {
		expect(STAMP.path(TRANSCRIPT)).not.toBe(STAMP.path(OTHER_TRANSCRIPT))
	})
})

// **A guard that could not look must not read the same as one that looked and was satisfied**
// (joshuafolkken/kit#1509). Failing open is right and is not being revisited; failing open in silence
// is what let the batching guard sit dead for two hours with nothing in the run to say so.
function guard_over(prefix: string, will_block: boolean): TranscriptGuard {
	return hook_decision.create_transcript_guard({
		prefix,
		switch_key: OTHER_SWITCH_KEY,
		is_candidate: () => true,
		should_block: () => will_block,
		reason: REASON,
	})
}

describe('hook_decision — a fault is reported instead of being swallowed', () => {
	it('allows the call and names the fault where the history cannot be read', () => {
		process.env[OTHER_SWITCH_KEY] = UNSET
		mkdirSync(UNREADABLE_TRANSCRIPT, { recursive: true })

		const raw = payload_text(UNREADABLE_TRANSCRIPT)
		const { reason, fault } = guard_over(STAMP_PREFIX, true).outcome(raw, NOW_MS)

		expect(reason).toBeUndefined()
		expect(fault).toContain(OTHER_SWITCH_KEY)
	})

	// **The routine case stays silent.** A delegated unit's transcript is named before anything is
	// written under it, so a fork's first guarded calls read a path with no file behind it. Reported
	// as a fault it would print on every one of them, which is the noise drowning the signal.
	it('stays silent where the transcript does not exist yet', () => {
		const raw = payload_text(MISSING_TRANSCRIPT)

		expect(guard_over(STAMP_PREFIX, true).outcome(raw, NOW_MS).fault).toBeUndefined()
	})

	// The refusal-only shape is what the other two guards still call, so it has to keep answering
	// exactly what it did before — a fault is not a refusal.
	it('keeps the refusal-only answer undefined on a fault', () => {
		mkdirSync(UNREADABLE_TRANSCRIPT, { recursive: true })

		const raw = payload_text(UNREADABLE_TRANSCRIPT)

		expect(guard_over(STAMP_PREFIX, true).refusal(raw, NOW_MS)).toBeUndefined()
	})

	// The refusal rests on the stamp: without one the same call could be refused again and wedge the
	// run. So the refusal is withheld — and now says why, naming the guard that withheld it rather
	// than whichever of the three the text was first written for.
	it('reports the stamp it could not write, naming the guard that raised it', () => {
		writeFileSync(TRANSCRIPT, '')

		const guard = guard_over(BLOCKED_STAMP_PREFIX, true)

		mkdirSync(guard.refusal_path(TRANSCRIPT), { recursive: true })

		expect(guard.outcome(payload_text(), NOW_MS).fault).toBe(
			hook_decision.stamp_fault(OTHER_SWITCH_KEY),
		)
	})
})

describe('hook_decision.notice_envelope', () => {
	// **It carries no `permissionDecision`, which is what makes it a notice.** Both channels are
	// filled because either alone leaves one of the two watchers blind: `additionalContext` reaches
	// the model, `systemMessage` reaches the person.
	it('says the fault on both channels and decides nothing', () => {
		expect(JSON.parse(hook_decision.notice_envelope(REASON))).toEqual({
			systemMessage: REASON,
			hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: REASON },
		})
	})
})

describe('hook_decision.load_environment_file', () => {
	it('does not throw where there is no env file to load', () => {
		expect(() => {
			hook_decision.load_environment_file()
		}).not.toThrow()
	})
})
