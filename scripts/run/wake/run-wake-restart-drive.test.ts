import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { josh_command } from '#scripts/josh/josh-run'
import { run_carry, type CarryOwner } from '#scripts/run/carry/run-carry'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { run_wake } from './run-wake'
import { run_wake_cli } from './run-wake-cli'
import type { WakeContext } from './run-wake-describe'
import { run_wake_loop, type LoopPorts, type LoopStop } from './run-wake-loop'
import { run_wake_restart } from './run-wake-restart'

// joshuafolkken/kit#3701: a driver that exited non-zero left the carry record adopted for the
// supervisor's own process, so every restarted pass read that owner as a session at work and waited
// on itself — the driver ran once, the restart bound was never reached and nothing was reported.
// These cases run the supervisor's real ports, loop, restart and driver; only the driver's command,
// the clock between passes, the event stream and the lane-close retry are stood in for.

const LIMIT = run_wake_restart.RESTART_LIMIT
const INVOCATION = 'backlogrun #2509 --max 5 --only'
const PROFILE = agent_role_profile.DEFAULT_PROFILES.scheduler
const CAUSE = 'error GitHub did not answer'
const DRIVER_FAILURE = { code: 1, out: CAUSE, err: 'pnpm josh backlog:next' }
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

function begin(owner: CarryOwner): void {
	run_carry.begin_carry(context().carry_target, INVOCATION, owner, new Date())
	run_wake.write_wake(context().wake_target, run_wake.fresh_wake(INVOCATION, new Date(), PROFILE))
}

// A pass that waits has no end of its own: removing the wake record is the `--stop` that ends the
// loop, so a supervisor that waits where it should drive answers `stopped` rather than hanging.
async function stop_at_the_first_wait(): Promise<void> {
	run_wake.remove_wake(context().wake_target)
}

async function supervise(): Promise<LoopStop> {
	const ports: LoopPorts = {
		...run_wake_cli.ports_for(context(), PROFILE),
		sleep: stop_at_the_first_wait,
		// The retry reads and closes the checkout's own lanes, which are a live run's: never from a test.
		retry_closes: async () => undefined,
	}

	return await run_wake_restart.supervise({
		pass: async () => await run_wake_loop.run_loop(context().wake_target, ports, 0),
		is_resumable: () => run_carry.read_carry(context().carry_target).kind === 'carried',
		pause: async () => undefined,
		note: () => undefined,
	})
}

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'josh-wake-restart-drive-'))
	// The stage a claim writes goes to the checkout's own stream, which is a live run's: never from a test.
	vi.spyOn(run_event_setup, 'emit').mockResolvedValue()
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue(DRIVER_FAILURE)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(scratch.directory, { recursive: true, force: true })
})

test('re-drives a failed driver on every restart and stops as failed at the bound', async () => {
	begin(run_carry.NO_OWNER)

	const stop = await supervise()

	expect(josh_command.josh_run).toHaveBeenCalledTimes(LIMIT + 1)
	expect(stop.reason).toBe('failed')
	expect(stop.note).toContain(CAUSE)
	expect(stop.note).toContain(`after ${String(LIMIT)} automatic restarts`)
})

test('waits on a record another live process holds and never drives it', async () => {
	begin(run_carry.owner_of(process.ppid))

	const stop = await supervise()

	expect(stop.reason).toBe('stopped')
	expect(josh_command.josh_run).not.toHaveBeenCalled()
	expect(run_carry.read_carry(context().carry_target)).toMatchObject({
		carry: { owner_pid: process.ppid },
	})
})
