import { build_text, telegram_notify } from '#scripts/notify/telegram-notify'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_wake_cli } from './run-wake-cli'
import type { WakeContext } from './run-wake-describe'

// joshuafolkken/kit#3242. The Telegram limit cuts a long body from the tail, so the line that says
// where the log is must come before the failure note, or the cut takes it.

const LOG_TARGET = '/stub/wake.log'
const LONG_NOTE_REPEAT = 2000

const CONTEXT: WakeContext = {
	carry_target: '/stub/carry.json',
	wake_target: '/stub/wake.json',
	log_target: LOG_TARGET,
	event_target: '/stub/events.jsonl',
	worktree: '/stub/repo',
}

describe('run_wake_cli.warning_body', () => {
	it('keeps the log hint when the Telegram limit cuts a long failure note', () => {
		const note = `error spawn git ENOENT\n${'stderr line\n'.repeat(LONG_NOTE_REPEAT)}`
		const body = run_wake_cli.warning_body({ reason: 'failed', note }, 'The wake failed.', CONTEXT)
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
		const body = run_wake_cli.warning_body(
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

function stub_strand(is_left_stranded: boolean): void {
	vi.spyOn(run_stranded_detect, 'is_left_stranded').mockReturnValue(is_left_stranded)
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
}

function silence(): void {
	vi.spyOn(console, 'error').mockReturnValue()
	vi.spyOn(console, 'log').mockReturnValue()
}

describe('run_wake_cli.record_failure', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('leaves a stranded event carrying the driver’s own error on a failed stop', async () => {
		stub_strand(true)

		await run_wake_cli.record_failure(FAILED_STOP, CONTEXT, true)

		expect(run_stranded_detect.is_left_stranded).toHaveBeenCalledWith(CONTEXT.carry_target)
		expect(run_event_stream_emit.emit).toHaveBeenCalledExactlyOnceWith(
			run_event_stream.EVENT_KIND.STRANDED,
			'The supervisor failed and stopped watching the run — error The carry record read `none` with its file absent, 6 times in a row.',
		)
	})

	it('leaves no event on a stop that is not a failure', async () => {
		stub_strand(true)

		await run_wake_cli.record_failure({ reason: 'unreadable', note: undefined }, CONTEXT, true)

		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})

	// A `run:carry --end` under a live driver fails the supervisor too, and that run ended cleanly.
	it('leaves no event when the failed stop does not leave the run stranded', async () => {
		stub_strand(false)

		await run_wake_cli.record_failure(FAILED_STOP, CONTEXT, true)

		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})

	// The event is the marker the stop-time detector holds its notification back on.
	it('leaves no event when the warning reached nobody', async () => {
		stub_strand(true)

		await run_wake_cli.record_failure(FAILED_STOP, CONTEXT, false)

		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})
})

describe('run_wake_cli.finish', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('leaves the stranded event once the warning of a failed stop was sent', async () => {
		silence()
		stub_strand(true)

		vi.spyOn(telegram_notify, 'warn').mockResolvedValue(true)

		const code = await run_wake_cli.finish(FAILED_STOP, CONTEXT)

		expect(code).toBe(1)
		expect(run_event_stream_emit.emit).toHaveBeenCalledOnce()
	})

	it('leaves the marker to the stop-time detector when the warning failed to send', async () => {
		silence()
		stub_strand(true)

		vi.spyOn(telegram_notify, 'warn').mockResolvedValue(false)

		await run_wake_cli.finish(FAILED_STOP, CONTEXT)

		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})
})
