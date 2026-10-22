import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_wake, type RunWake, type WakeStopReason } from './run-wake'
import { run_wake_cli } from './run-wake-cli'
import { run_wake_code } from './run-wake-code'
import type { WakeContext } from './run-wake-describe'
import { run_wake_loop } from './run-wake-loop'
import { run_wake_session } from './run-wake-session'
import { run_wake_supervise } from './run-wake-supervise'
import { run_wake_takeover } from './run-wake-takeover'

// joshuafolkken/kit#4509: a supervisor whose code changed hands the run to a successor on the new code,
// and says so on the run's stream; a successor that did not start is a failed stop, so it warns.

const PROFILE = agent_role_profile.DEFAULT_PROFILES.scheduler
const INTERVAL_MS = 30_000
const SUCCESSOR_PID = 5151
const LAUNCH_NOTE = 'claude is not on PATH'
const INVOCATION = 'backlogrun --max 5 --idle 30'
const scratch = { directory: '' }

function context(): WakeContext {
	return {
		carry_target: path.join(scratch.directory, 'carry.json'),
		ended_target: path.join(scratch.directory, 'ended.json'),
		wake_target: path.join(scratch.directory, 'wake.json'),
		log_target: path.join(scratch.directory, 'wake.log'),
		event_target: path.join(scratch.directory, 'events.jsonl'),
		git_directory: path.join(scratch.directory, '.git'),
		worktree: scratch.directory,
	}
}

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'josh-wake-cli-reload-'))
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(run_wake_takeover, 'await_takeover').mockResolvedValue('taken')
	vi.spyOn(console, 'error').mockReturnValue()
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(scratch.directory, { recursive: true, force: true })
})

describe('run_wake_cli.reload', () => {
	it('notes the hand-over on the stream once the successor launched', async () => {
		vi.spyOn(run_wake_session, 'launch').mockReturnValue({ kind: 'launched', pid: SUCCESSOR_PID })

		const stop = await run_wake_cli.reload(context(), INTERVAL_MS, PROFILE)

		expect(stop).toStrictEqual({ reason: run_wake_loop.RELOAD_REASON, note: undefined })
		expect(run_event_stream_emit.emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.NOTE,
			expect.stringContaining(String(SUCCESSOR_PID)),
		)
	})

	it('fails the stop when the successor did not start', async () => {
		vi.spyOn(run_wake_session, 'launch').mockReturnValue({ kind: 'failed', note: LAUNCH_NOTE })

		const stop = await run_wake_cli.reload(context(), INTERVAL_MS, PROFILE)

		expect(stop).toStrictEqual({
			reason: run_wake_loop.FAILED_REASON,
			note: `${run_wake_cli.RELOAD_FAILED_NOTE}: ${LAUNCH_NOTE}`,
		})
		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})
})

// A spawn is not a take-over: a successor that died at load would otherwise leave the run unwatched.
describe('run_wake_cli.reload — the successor takes the run over', () => {
	it.each([
		['died', 'it exited before it claimed the run'],
		['unclaimed', 'it did not claim the run in time'],
	] as const)('fails the stop when the launched successor %s', async (takeover, note) => {
		vi.spyOn(run_wake_session, 'launch').mockReturnValue({ kind: 'launched', pid: SUCCESSOR_PID })
		vi.spyOn(run_wake_takeover, 'await_takeover').mockResolvedValue(takeover)

		const stop = await run_wake_cli.reload(context(), INTERVAL_MS, PROFILE)

		expect(stop).toStrictEqual({
			reason: run_wake_loop.FAILED_REASON,
			note: `${run_wake_cli.RELOAD_FAILED_NOTE}: ${note}`,
		})
		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})

	it('waits for the launched successor itself to take the run over', async () => {
		vi.spyOn(run_wake_session, 'launch').mockReturnValue({ kind: 'launched', pid: SUCCESSOR_PID })

		await run_wake_cli.reload(context(), INTERVAL_MS, PROFILE)

		expect(run_wake_takeover.await_takeover).toHaveBeenCalledWith(SUCCESSOR_PID, expect.anything())
	})

	it('leaves the carry record for the successor to adopt', async () => {
		vi.spyOn(run_wake_session, 'launch').mockReturnValue({ kind: 'launched', pid: SUCCESSOR_PID })
		run_carry.begin_carry(context().carry_target, INVOCATION)

		await run_wake_cli.reload(context(), INTERVAL_MS, PROFILE)

		expect(run_carry.read_carry(context().carry_target).kind).toBe('carried')
	})

	it('relaunches on the interval it ran at, in seconds', async () => {
		const launch = vi
			.spyOn(run_wake_session, 'launch')
			.mockReturnValue({ kind: 'launched', pid: SUCCESSOR_PID })

		await run_wake_cli.reload(context(), INTERVAL_MS, PROFILE)

		expect(launch.mock.calls[0]?.[0].argv.args).toContain('30')
	})
})

function supervise_until(reason: WakeStopReason): void {
	vi.spyOn(run_wake_code, 'watch').mockResolvedValue(async () => false)
	vi.spyOn(run_wake_supervise, 'supervise').mockResolvedValue({ reason, note: undefined })
	run_wake.claim(context().wake_target, INVOCATION, new Date(), PROFILE)
}

// A record this live process still held would refuse the successor's claim.
describe('run_wake_cli.supervised', () => {
	it('removes its own wake record before it launches the successor', async () => {
		const held_at_launch: Array<RunWake | undefined> = []

		vi.spyOn(run_wake_session, 'launch').mockImplementation(() => {
			held_at_launch.push(run_wake.read_wake(context().wake_target))

			return { kind: 'launched', pid: SUCCESSOR_PID }
		})
		supervise_until(run_wake_loop.RELOAD_REASON)

		await run_wake_cli.supervised(context(), INTERVAL_MS, PROFILE)

		expect(held_at_launch).toStrictEqual([undefined])
	})

	it('hands on nothing when its record was taken over before the reload', async () => {
		const launch = vi.spyOn(run_wake_session, 'launch')

		supervise_until(run_wake_loop.RELOAD_REASON)
		run_wake.remove_wake(context().wake_target)

		const stop = await run_wake_cli.supervised(context(), INTERVAL_MS, PROFILE)

		expect([launch.mock.calls.length, stop.reason]).toStrictEqual([0, 'stopped'])
	})

	it('launches no successor when the loop stopped for any other reason', async () => {
		const launch = vi.spyOn(run_wake_session, 'launch')

		supervise_until('stopped')

		await run_wake_cli.supervised(context(), INTERVAL_MS, PROFILE)

		expect(launch).not.toHaveBeenCalled()
	})
})

// Ending the broker mid-review would wait out that review with the run unwatched.
describe('run_wake_cli.supervised — the code check', () => {
	it('reads no change while a lane request is being answered, and the change once idle', async () => {
		const is_stale = vi.fn(async () => true)
		const checks: Array<boolean> = []

		vi.spyOn(run_wake_code, 'watch').mockResolvedValue(is_stale)
		vi.spyOn(lane_session_broker, 'is_answering').mockReturnValueOnce(true).mockReturnValue(false)
		vi.spyOn(run_wake_supervise, 'supervise').mockImplementation(async ({ ports }) => {
			checks.push(await ports.is_code_stale(), await ports.is_code_stale())

			return { reason: 'stopped', note: undefined }
		})

		await run_wake_cli.supervised(context(), INTERVAL_MS, PROFILE)

		expect([checks, is_stale.mock.calls.length]).toStrictEqual([[false, true], 1])
	})
})
