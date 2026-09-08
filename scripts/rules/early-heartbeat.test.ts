import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_progress } from '#scripts/run/run-progress'
import { run_progress_clock } from '#scripts/run/run-progress-clock'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { early_heartbeat } from './early-heartbeat'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#1570. The three things the Issue asked to be able to demonstrate: an automatic
// heartbeat cannot be armed before the interval has elapsed, one armed for the full interval is
// allowed through, and an explicit ask is never touched at all.
//
// **Nothing here drives the live watcher.** The clock is a record on disk and the decision reads it,
// so the suite replaces the reading rather than the file — a test that marked the real record would
// silence the reporting of whatever run is in flight on the same machine.

const MINUTE_MS = 60_000
const INTERVAL_MS = 20 * MINUTE_MS
const NOW_MS = 1_700_000_000_000
const TRANSCRIPTS = new Set<string>()

const EXPLICIT_ASK = 'pnpm josh run:progress --once'
// A timer armed for the whole interval — the one arm that is always legitimate, reused wherever a case
// needs the early test to pass so that only the live-timer half is under examination.
const FULL_INTERVAL_SLEEP = 'sleep 1200'
// Five minutes, which lands well inside the interval whatever the last report was.
const EARLY_SLEEP = 'sleep 300'

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'early-heartbeat-'))
const RULE_ID = 'early-heartbeat'

// A real, empty transcript: the decision reads the call and the clock, never the history, so an empty
// file is the honest fixture — and the guard needs a path it can actually read.
function transcript_named(name: string): string {
	const target = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(target, '')
	TRANSCRIPTS.add(target)

	return target
}

// The clock, without the git call and without the machine's own record.
function with_last_report(elapsed_ms: number | undefined): void {
	vi.spyOn(run_progress_clock, 'read_last_report_sync').mockReturnValue(
		elapsed_ms === undefined ? undefined : NOW_MS - elapsed_ms,
	)
}

function arm(name: string, command: string, now_ms = NOW_MS, can_record = true): boolean {
	return early_heartbeat.decide(
		{ name: 'Bash', input: { command } },
		{ transcript: transcript_named(name), now_ms },
		can_record,
	)
}

function payload_for(transcript: string, command: string): string {
	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: transcript,
		tool_name: 'Bash',
		tool_input: { command },
	})
}

// Assigned rather than deleted: an empty value is not one the disabled list recognizes, so the guard
// reads as on exactly as it does on a fresh machine. The interval is blanked for the opposite reason
// — `decide` reads the real environment, so a machine that exports the documented variable would
// otherwise change the answer of every case below.
beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
	vi.stubEnv(run_progress.INTERVAL_KEY, '')
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

afterAll(() => {
	for (const transcript of TRANSCRIPTS) {
		rmSync(stamp_file.stamp_path(early_heartbeat.ARM_PREFIX, transcript), { force: true })
		rmSync(delivered_rules.delivery_path(RULE_ID, transcript), { force: true })
	}

	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

describe('is_wait_timer — the call whose whole purpose is to wait', () => {
	it.each([
		'sleep 600',
		'sleep 10m',
		'sleep 300 && echo awake',
		'sleep 60 ; :',
		'sleep 1200 || true',
		'sleep 1200 &',
	])('reads %j as an armed timer', (command) => {
		expect(early_heartbeat.is_wait_timer(command)).toBe(true)
	})

	// A sleep that waits *for* something, an explicit ask, and two ordinary calls. The loop is the one
	// worth naming: it ends on its condition, so refusing it would take polling away from a run that is
	// waiting on a thing rather than on a clock.
	it.each([
		'until gh pr checks 1; do sleep 30; done',
		'sleep 5 && pnpm josh gate',
		EXPLICIT_ASK,
		'pnpm josh followup',
		'gh issue view 1570',
	])('leaves %j alone', (command) => {
		expect(early_heartbeat.is_wait_timer(command)).toBe(false)
	})
})

describe('wait_duration_ms — how long the armed timer runs', () => {
	it.each([
		['sleep 600', 600_000],
		['sleep 10m', 600_000],
		['sleep 1.5', 1500],
		['sleep 60 && sleep 60', 120_000],
	])('reads %j as %i ms', (command, expected) => {
		expect(early_heartbeat.wait_duration_ms(command)).toBe(expected)
	})
})

describe('decide — the mechanism, not the parent self-restraining', () => {
	it('refuses a timer whose report would land before the interval has elapsed', () => {
		with_last_report(5 * MINUTE_MS)

		expect(arm('early', EARLY_SLEEP)).toBe(true)
	})

	it('allows a timer that runs until the interval is up', () => {
		with_last_report(5 * MINUTE_MS)

		expect(arm('due', `sleep ${String((INTERVAL_MS - 5 * MINUTE_MS) / 1000)}`)).toBe(false)
	})

	// Nothing legitimate waits longer than one interval, and allowing one would mean recording an
	// expiry shorter than the timer really has — which is the double-timer defect all over again.
	it('refuses a timer that runs longer than the interval', () => {
		with_last_report(INTERVAL_MS)

		expect(arm('overlong', 'sleep 2400')).toBe(true)
	})

	// The half the Issue was filed on: the second arm is what produced reports minutes apart, and it
	// is refused **again** rather than once per run.
	it('refuses a second timer while the first is still live, every time it is armed', () => {
		with_last_report(INTERVAL_MS)

		expect(arm('live', FULL_INTERVAL_SLEEP)).toBe(false)
		expect(arm('live', FULL_INTERVAL_SLEEP, NOW_MS + MINUTE_MS)).toBe(true)
		expect(arm('live', FULL_INTERVAL_SLEEP, NOW_MS + 2 * MINUTE_MS)).toBe(true)
	})

	it('allows the next timer once the armed one has fired', () => {
		with_last_report(INTERVAL_MS)

		expect(arm('expired', FULL_INTERVAL_SLEEP)).toBe(false)
		expect(arm('expired', FULL_INTERVAL_SLEEP, NOW_MS + INTERVAL_MS + MINUTE_MS)).toBe(false)
	})

	// The scope joshuafolkken/kit#1570 put out of bounds, held by the absence of a record rather than
	// by a judgement about what kind of session this is.
	it('refuses nothing where no progress record exists', () => {
		with_last_report(undefined)

		expect(arm('no-clock', 'sleep 5')).toBe(false)
	})

	// The record is written before the sleep starts and nothing runs it back, so a call another hook is
	// about to refuse must leave no trace — otherwise a timer that never ran locks out the legitimate
	// arm behind it.
	it('records nothing for a call that may never run', () => {
		with_last_report(INTERVAL_MS)

		expect(arm('phantom', FULL_INTERVAL_SLEEP, NOW_MS, false)).toBe(false)
		expect(arm('phantom', FULL_INTERVAL_SLEEP, NOW_MS + MINUTE_MS)).toBe(false)
	})
})

describe('rule_delivery — the row, through the hook that carries it', () => {
	it('delivers the rule on the call that arms an early timer', () => {
		with_last_report(5 * MINUTE_MS)

		const payload = payload_for(transcript_named('delivered'), EARLY_SLEEP)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.EARLY_HEARTBEAT_REASON)
	})

	// **Not once per run.** Every other row is delivered once because the run then obeys it; this one
	// guards a recurring act, and a single refusal would hand the enforcement straight back to the
	// self-restraint that failed.
	it('delivers again on the reissue rather than once per run', () => {
		with_last_report(5 * MINUTE_MS)

		const payload = payload_for(transcript_named('repeat'), EARLY_SLEEP)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.EARLY_HEARTBEAT_REASON)
		expect(rule_delivery(payload, NOW_MS + 1)).toBe(delivered_rules.EARLY_HEARTBEAT_REASON)
	})

	it('says nothing about an explicitly requested report', () => {
		with_last_report(MINUTE_MS)

		const payload = payload_for(transcript_named('explicit'), EXPLICIT_ASK)

		expect(rule_delivery(payload, NOW_MS)).toBeUndefined()
	})
})
