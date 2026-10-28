import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { build_text, telegram_notify } from '#scripts/notify/telegram-notify'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_stranded_detect, type WatchedRun } from '#scripts/run/run-stranded-detect'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { WakeContext } from './run-wake-describe'
import { run_wake_finish } from './run-wake-finish'

// joshuafolkken/kit#3242. The Telegram limit cuts a long body from the tail, so the line that says
// where the log is must come before the failure note, or the cut takes it.

const LOG_TARGET = '/stub/wake.log'
const LONG_NOTE_REPEAT = 2000

const STARTED_AT = '2026-10-11T21:17:08.375Z'

const CONTEXT: WakeContext = {
	carry_target: '/stub/carry.json',
	ended_target: '/stub/ended.json',
	wake_target: '/stub/wake.json',
	log_target: LOG_TARGET,
	event_target: '/stub/events.jsonl',
	git_directory: '/stub/repo/.git',
	worktree: '/stub/repo',
}

// joshuafolkken/kit#1746. `backlogrun.md` promises that a failure is visible rather than silent, and
// only one of the reasons a supervisor can stop on was wired to the notification — so a run left
// asleep by an unreadable carry record reached nobody at all.
describe('run_wake_finish.stop_body — which stops reach a person', () => {
	it('warns on the stops that leave a carried run with nobody watching it', () => {
		expect(run_wake_finish.stop_body('failed')).toBeDefined()
		expect(run_wake_finish.stop_body('unreadable')).toBeDefined()
	})

	// The run finished, or a person stopped the supervisor themselves. A warning channel that fires on
	// those is one that stops being read.
	it('stays silent where nothing went wrong', () => {
		expect(run_wake_finish.stop_body('ended')).toBeUndefined()
		expect(run_wake_finish.stop_body('stopped')).toBeUndefined()
		expect(run_wake_finish.stop_body('reload')).toBeUndefined()
	})
})

describe('run_wake_finish.warning_body', () => {
	it('keeps the log hint when the Telegram limit cuts a long failure note', () => {
		const note = `error spawn git ENOENT\n${'stderr line\n'.repeat(LONG_NOTE_REPEAT)}`
		const body = run_wake_finish.warning_body(
			{ reason: 'failed', note },
			'The wake failed.',
			CONTEXT,
		)
		const text = build_text({
			task_type: 'warning',
			repo_name: 'kit',
			issue_title: 'run:wake supervisor',
			body,
			issue_url: undefined,
			pr_url: undefined,
		})

		expect(text).toContain(LOG_TARGET)
		expect(text).toContain('error spawn git ENOENT')
	})

	it('leaves out a missing note', () => {
		const body = run_wake_finish.warning_body(
			{ reason: 'unreadable', note: undefined },
			'Unreadable.',
			CONTEXT,
		)

		expect(body.split('\n')).toHaveLength(2)
	})
})

// joshuafolkken/kit#3697: a supervisor that gave up left nothing on the stream, so the run's last
// event was a merge and the run read as still watching.
const NOTE = 'error The carry record read `none` with its file absent, 6 times in a row.\ntail'
const FAILED_STOP = { reason: 'failed', note: NOTE } as const
const WATCHED: WatchedRun = { ...CONTEXT, started_at: STARTED_AT }

function stub_strand(is_left_stranded: boolean): void {
	vi.spyOn(run_stranded_detect, 'is_left_stranded').mockReturnValue(is_left_stranded)
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
}

function silence(): void {
	vi.spyOn(console, 'error').mockReturnValue()
	vi.spyOn(console, 'info').mockReturnValue()
}

describe('run_wake_finish.record_failure', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('leaves a stranded event carrying the driver’s own error on a failed stop', async () => {
		stub_strand(true)

		await run_wake_finish.record_failure(FAILED_STOP, WATCHED, true)

		expect(run_stranded_detect.is_left_stranded).toHaveBeenCalledWith(WATCHED)
		expect(run_event_stream_emit.emit).toHaveBeenCalledExactlyOnceWith(
			run_event_stream.EVENT_KIND.STRANDED,
			'The supervisor failed and stopped watching the run — error The carry record read `none` with its file absent, 6 times in a row.',
		)
	})

	it('leaves no event on a stop that is not a failure', async () => {
		stub_strand(true)

		await run_wake_finish.record_failure({ reason: 'unreadable', note: undefined }, WATCHED, true)

		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})

	// A `run:carry --end` under a live driver fails the supervisor too, and that run ended cleanly.
	it('leaves no event when the failed stop does not leave the run stranded', async () => {
		stub_strand(false)

		await run_wake_finish.record_failure(FAILED_STOP, WATCHED, true)

		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})

	// The event is the marker the stop-time detector holds its notification back on.
	it('leaves no event when the warning reached nobody', async () => {
		stub_strand(true)

		await run_wake_finish.record_failure(FAILED_STOP, WATCHED, false)

		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})
})

// The states a failed supervisor actually meets, read through the real judgement and real records: the
// driver adopted the record for this very process, or the record stopped reading altogether.
const scratch = mkdtempSync(path.join(tmpdir(), 'run-wake-finish-test-'))

function watched_in(name: string): WatchedRun {
	return {
		carry_target: path.join(scratch, `${name}-carry.json`),
		ended_target: path.join(scratch, `${name}-ended.json`),
		started_at: STARTED_AT,
	}
}

function own_carry(): RunCarry {
	const owner = run_carry.owner_of(process.pid)

	return {
		...run_carry.fresh_carry('backlogrun', owner, new Date(STARTED_AT)),
		owner_pid: owner.pid,
		owner_start: owner.start,
	}
}

describe('run_wake_finish.record_failure — the records a failed supervisor leaves', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	afterAll(() => {
		rmSync(scratch, { recursive: true, force: true })
	})

	it('leaves the event when the driver left the record owned by this very process', async () => {
		const watched = watched_in('own')

		vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
		stamp_file.write_stamp(watched.carry_target, own_carry())

		await run_wake_finish.record_failure(FAILED_STOP, watched, true)

		expect(run_event_stream_emit.emit).toHaveBeenCalledOnce()
	})

	it('leaves the event when the record no longer reads and no `--end` closed the run', async () => {
		vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()

		await run_wake_finish.record_failure(FAILED_STOP, watched_in('unread'), true)

		expect(run_event_stream_emit.emit).toHaveBeenCalledOnce()
	})

	it('leaves no event when `run:carry --end` closed this run under the driver', async () => {
		const watched = watched_in('ended')

		vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
		run_carry_ended.record_ended(watched.ended_target, { kind: 'carried', carry: own_carry() })

		await run_wake_finish.record_failure(FAILED_STOP, watched, true)

		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})
})

describe('run_wake_finish.finish', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('leaves the stranded event once the warning of a failed stop was sent', async () => {
		silence()
		stub_strand(true)

		vi.spyOn(telegram_notify, 'warn').mockResolvedValue(true)

		const code = await run_wake_finish.finish(FAILED_STOP, CONTEXT, STARTED_AT)

		expect(code).toBe(1)
		expect(console.info).toHaveBeenCalledWith('failed')
		expect(run_event_stream_emit.emit).toHaveBeenCalledOnce()
	})

	it('leaves the marker to the stop-time detector when the warning failed to send', async () => {
		silence()
		stub_strand(true)

		vi.spyOn(telegram_notify, 'warn').mockResolvedValue(false)

		await run_wake_finish.finish(FAILED_STOP, CONTEXT, STARTED_AT)

		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})
})
