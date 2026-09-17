import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
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
// The notice disposition's fixtures (joshuafolkken/kit#1848): its own transcript and two record
// prefixes, so a notice's record is cleaned apart from the refusal's.
const NOTICE_TEXT = 'so this write makes three in a row'
const NOTIFY_STAMP_PREFIX = 'josh-hook-decision-notify-'
const NOTIFY_BLOCK_PREFIX = 'josh-hook-decision-notify-block-'
const NOTIFY_TRANSCRIPT = path.join(WORK_DIRECTORY, 'notify.jsonl')

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

	for (const prefix of [NOTIFY_STAMP_PREFIX, NOTIFY_BLOCK_PREFIX]) {
		rmSync(hook_decision.create_refusal_stamp(prefix).path(NOTIFY_TRANSCRIPT), { force: true })
	}

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
	// Set per test rather than once in the first one: every case below reads this switch, and taking it
	// from whatever a preceding case left behind makes each of them pass only in file order.
	beforeEach(() => {
		process.env[OTHER_SWITCH_KEY] = UNSET
	})

	it('allows the call and names the fault where the history cannot be read', () => {
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

// A guard that supplies a notify spec (joshuafolkken/kit#1848): for a call it does not refuse, it can
// emit a non-blocking notice instead, on a record of its own so a notice never spends the refusal's
// stamp. The batching guard supplies one for the whole-file write.
function notify_guard(will_block: boolean, will_notify: boolean): TranscriptGuard {
	return hook_decision.create_transcript_guard({
		prefix: NOTIFY_BLOCK_PREFIX,
		switch_key: OTHER_SWITCH_KEY,
		is_candidate: () => true,
		should_block: () => will_block,
		reason: REASON,
		notify: {
			prefix: NOTIFY_STAMP_PREFIX,
			// Sensitive to the last-fired instant, like the real rule: it fires only where the notice has
			// not fired on this sequence, so the record the shell arms is what stops the second look.
			should_notify: (_tail, _call, notified_at_ms) =>
				will_notify && notified_at_ms === hook_decision.NEVER_MS,
			text: NOTICE_TEXT,
		},
	})
}

// Cleared before each case so one case's record never silences another's, and the switch set on so a
// shell that left it off cannot turn the suite green on a guard that never fired.
function clear_notify_records(): void {
	process.env[OTHER_SWITCH_KEY] = UNSET
	writeFileSync(NOTIFY_TRANSCRIPT, '')

	for (const prefix of [NOTIFY_STAMP_PREFIX, NOTIFY_BLOCK_PREFIX]) {
		rmSync(hook_decision.create_refusal_stamp(prefix).path(NOTIFY_TRANSCRIPT), { force: true })
	}
}

describe('hook_decision — the optional notice disposition emits a notice', () => {
	beforeEach(clear_notify_records)

	it('returns a notice, not a reason, where the notify rule fires and the block rule does not', () => {
		const { reason, notice } = notify_guard(false, true).outcome(
			payload_text(NOTIFY_TRANSCRIPT),
			NOW_MS,
		)

		expect(reason).toBeUndefined()
		expect(notice).toBe(NOTICE_TEXT)
	})

	// The record makes it fire once — a second look at the same sequence says nothing.
	it('notifies the same sequence only once', () => {
		const guard = notify_guard(false, true)
		const raw = payload_text(NOTIFY_TRANSCRIPT)

		expect(guard.outcome(raw, NOW_MS).notice).toBe(NOTICE_TEXT)
		expect(guard.outcome(raw, NOW_MS).notice).toBeUndefined()
	})

	// The block path decides first, so a call both rules would fire on is refused, not merely noticed.
	it('prefers the refusal where both rules would fire', () => {
		const { reason, notice } = notify_guard(true, true).outcome(
			payload_text(NOTIFY_TRANSCRIPT),
			NOW_MS,
		)

		expect(reason).toBe(REASON)
		expect(notice).toBeUndefined()
	})
})

describe('hook_decision — the notice does not disturb the refusal', () => {
	beforeEach(clear_notify_records)

	// **The notice never spends the refusal's stamp.** After a notice has armed its own record, a
	// genuine refusal on the same transcript still fires — the two dispositions dedupe apart.
	it('leaves the refusal free to fire after a notice has fired', () => {
		const raw = payload_text(NOTIFY_TRANSCRIPT)

		expect(notify_guard(false, true).outcome(raw, NOW_MS).notice).toBe(NOTICE_TEXT)
		expect(notify_guard(true, false).outcome(raw, NOW_MS).reason).toBe(REASON)
	})

	// A guard that supplies no notify spec is unchanged: the notice is simply never set.
	it('never sets a notice for a guard with no notify spec', () => {
		expect(
			guard_over(STAMP_PREFIX, false).outcome(payload_text(NOTIFY_TRANSCRIPT), NOW_MS).notice,
		).toBeUndefined()
	})
})

describe('hook_decision.load_environment_file', () => {
	it('does not throw where there is no env file to load', () => {
		expect(() => {
			hook_decision.load_environment_file()
		}).not.toThrow()
	})
})
