import { git_location_environment } from '#scripts/git/git-location-environment'
import { poll } from '#scripts/lib/poll'
import { execa, execaSync } from 'execa'
import { josh_harness_environment, type JoshEnvironment } from './josh-harness-environment'

// The runner half of the integration harness (joshuafolkken/kit#2447): josh spawned as a subprocess
// into one of the environments `josh-harness-environment.ts` assembles. `run` waits for the command;
// `start` does not, so two commands launched back to back overlap — the shape a race like #2434 needs
// — and `wait_for` holds the second launch until the first has reached the point the race is about.

interface HarnessResult {
	exit_code: number | undefined
	stdout: string
	stderr: string
	is_timed_out: boolean
}

const DEFAULT_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 50

// The child must not act on this process's surroundings: git's location variables would point it at
// another repository, a lane mark would make it a dispatched child, and `PORT_SEED` would decide what
// a port assertion sees. Blanked here so every scenario starts from the same place.
const CHILD_ENVIRONMENT: Record<string, string | undefined> = {
	...git_location_environment.location_free_environment(),
	JOSH_LANE_CHILD: '',
	PORT_SEED: undefined,
}

interface ExecaOutcome {
	exitCode?: number | undefined
	stdout: unknown
	stderr: unknown
	timedOut: boolean
}

function to_result(outcome: ExecaOutcome): HarnessResult {
	return {
		exit_code: outcome.exitCode,
		stdout: String(outcome.stdout),
		stderr: String(outcome.stderr),
		is_timed_out: outcome.timedOut,
	}
}

function spawn_options(
	environment: JoshEnvironment,
	timeout_ms: number,
): { cwd: string; env: Record<string, string | undefined>; reject: false; timeout: number } {
	return { cwd: environment.root, env: CHILD_ENVIRONMENT, reject: false, timeout: timeout_ms }
}

function run(
	environment: JoshEnvironment,
	cli_arguments: ReadonlyArray<string>,
	timeout_ms: number = DEFAULT_TIMEOUT_MS,
): HarnessResult {
	const { executable, leading_arguments } = environment.launcher

	return to_result(
		execaSync(
			executable,
			[...leading_arguments, ...cli_arguments],
			spawn_options(environment, timeout_ms),
		),
	)
}

async function start(
	environment: JoshEnvironment,
	cli_arguments: ReadonlyArray<string>,
	timeout_ms: number = DEFAULT_TIMEOUT_MS,
): Promise<HarnessResult> {
	const { executable, leading_arguments } = environment.launcher

	return to_result(
		await execa(
			executable,
			[...leading_arguments, ...cli_arguments],
			spawn_options(environment, timeout_ms),
		),
	)
}

async function wait_for(is_ready: () => boolean, timeout_ms: number): Promise<boolean> {
	return await poll.poll_until(async () => is_ready(), {
		attempts: Math.ceil(timeout_ms / POLL_INTERVAL_MS),
		interval_ms: POLL_INTERVAL_MS,
	})
}

const josh_harness = { ...josh_harness_environment, run, start, wait_for }

export type { HarnessResult }
export type { EnvironmentKind, JoshEnvironment } from './josh-harness-environment'
export { josh_harness }
