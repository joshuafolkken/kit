import { GIT_BINARY_KEY } from '#scripts/git/constants'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { poll } from '#scripts/lib/poll'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { execa } from 'execa'
import { josh_harness_environment, type JoshEnvironment } from './josh-harness-environment'

// The runner half of the integration harness: josh spawned as a subprocess
// into one of the environments `josh-harness-environment.ts` assembles. `run` returns a promise, so two
// commands launched back to back overlap when the caller awaits neither — the shape a race like #2434
// needs — and `wait_for` holds the second launch until the first has reached the point the race is about.
//
// **Every spawn is asynchronous, bounded and stopped as a whole tree**. A
// synchronous spawn froze the event loop, so vitest's own timeout could not fire, and a timeout that
// killed only the direct child left the gate it had started writing into a workspace already removed —
// one saturated run took 935 s. Each child leads a process group of its own, the group is killed once
// the child settles, and `stop_all` kills whatever a timed-out test left behind and names it.

interface HarnessResult {
	exit_code: number | undefined
	stdout: string
	stderr: string
	is_timed_out: boolean
}

interface CommandOptions {
	cwd: string
	env: Record<string, string | undefined>
	timeout_ms: number
}

interface LiveProcess {
	command: string
	started_at: number
}

const DEFAULT_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 50
const MS_PER_SECOND = 1000
const KILL_SIGNAL = 'SIGKILL'
// Signal 0 delivers nothing and runs every check, so it answers whether the group still has a member.
const PROBE_SIGNAL = 0

// The child must not act on this process's surroundings: git's location variables would point it at
// another repository, a lane mark would make it a dispatched child, and `PORT_SEED` would decide what
// a port assertion sees. Blanked here so every scenario starts from the same place. The guard's `git`
// binary is blanked too: the environment has no `origin`, so a fetch the real command makes there reaches
// nothing, and the shim would record it as a network call.
//
// **A gate the harness starts is always a nested gate**. It runs inside a unit
// suite whatever launched that suite; without the mark, a direct `vitest` run let it reserve cores and
// two such gates queued behind each other, while under `josh gate` neither did.
const CHILD_ENVIRONMENT: Record<string, string | undefined> = {
	...git_location_environment.location_free_environment(),
	[GIT_BINARY_KEY]: '',
	[unit_worker_share.NESTED_KEY]: unit_worker_share.NESTED_VALUE,
	JOSH_LANE_CHILD: '',
	PORT_SEED: undefined,
}

// Keyed by process group id — the leader's pid, since every child is spawned `detached`.
const live_processes = new Map<number, LiveProcess>()

interface ExecaOutcome {
	exitCode?: number | undefined
	stdout: unknown
	stderr: unknown
}

interface Deadline {
	is_fired: boolean
	timer?: NodeJS.Timeout
}

function to_result(outcome: ExecaOutcome, is_timed_out: boolean): HarnessResult {
	return {
		exit_code: outcome.exitCode,
		stdout: String(outcome.stdout),
		stderr: String(outcome.stderr),
		is_timed_out,
	}
}

// `ESRCH` once the group has no member left — the answer every caller wants, so it is swallowed.
function signal_group(group: number, signal: NodeJS.Signals | typeof PROBE_SIGNAL): boolean {
	try {
		process.kill(-group, signal)

		return true
	} catch {
		return false
	}
}

function is_running(group: number): boolean {
	return signal_group(group, PROBE_SIGNAL)
}

// A process group this harness did not spawn — a gate launched detached — so `stop_all` covers it too.
function track(group: number, command: string): void {
	live_processes.set(group, { command, started_at: Date.now() })
}

function describe_live(group: number, now: number): string {
	const live = live_processes.get(group)
	const seconds = ((now - (live?.started_at ?? now)) / MS_PER_SECOND).toFixed(1)

	return `${live?.command ?? String(group)} (pid ${String(group)}, running ${seconds} s)`
}

// Kills every group still alive and names each, so a test that timed out says what it was waiting on.
function stop_all(now: number = Date.now()): Array<string> {
	const stopped = [...live_processes.keys()]
		.filter((group) => is_running(group))
		.map((group) => describe_live(group, now))

	for (const group of live_processes.keys()) signal_group(group, KILL_SIGNAL)
	live_processes.clear()

	return stopped
}

// The harness's own deadline rather than execa's `timeout`: that one signals the direct child alone, and
// a descendant still holding the child's stdout keeps execa's promise open after the child has died.
function arm_deadline(group: number, timeout_ms: number): Deadline {
	const deadline: Deadline = { is_fired: false }

	deadline.timer = setTimeout(() => {
		deadline.is_fired = true
		signal_group(group, KILL_SIGNAL)
	}, timeout_ms)

	return deadline
}

// The child has settled, but a descendant may not have — the group goes with it.
function release(group: number, deadline: Deadline): void {
	clearTimeout(deadline.timer)
	signal_group(group, KILL_SIGNAL)
	live_processes.delete(group)
}

async function run_command(
	command: string,
	cli_arguments: ReadonlyArray<string>,
	options: CommandOptions,
): Promise<HarnessResult> {
	const { cwd, env, timeout_ms } = options
	const subprocess = execa(command, cli_arguments, { cwd, env, reject: false, detached: true })
	const group = subprocess.pid

	// No pid means the spawn itself failed, and execa settles with that failure on its own.
	if (group === undefined) return to_result(await subprocess, false)

	track(group, [command, ...cli_arguments].join(' '))
	const deadline = arm_deadline(group, timeout_ms)

	try {
		return to_result(await subprocess, deadline.is_fired)
	} finally {
		release(group, deadline)
	}
}

async function run(
	environment: JoshEnvironment,
	cli_arguments: ReadonlyArray<string>,
	timeout_ms: number = DEFAULT_TIMEOUT_MS,
): Promise<HarnessResult> {
	const { executable, leading_arguments } = environment.launcher

	return await run_command(executable, [...leading_arguments, ...cli_arguments], {
		cwd: environment.root,
		env: CHILD_ENVIRONMENT,
		timeout_ms,
	})
}

async function wait_for(is_ready: () => boolean, timeout_ms: number): Promise<boolean> {
	return await poll.poll_until(async () => is_ready(), {
		attempts: Math.ceil(timeout_ms / POLL_INTERVAL_MS),
		interval_ms: POLL_INTERVAL_MS,
	})
}

const josh_harness = {
	...josh_harness_environment,
	DEFAULT_TIMEOUT_MS,
	is_running,
	run,
	run_command,
	stop_all,
	track,
	wait_for,
}

export type { CommandOptions, HarnessResult }
export type { EnvironmentKind, JoshEnvironment } from './josh-harness-environment'
export { josh_harness }
