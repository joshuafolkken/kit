import { time_format } from '#scripts/time-runtime/time-format'

// The local half of `pnpm josh release` — the work tree and its install, the commit, the push — prints
// one line per step with its elapsed time, so the push's pre-hook cost can be read after a run; the
// pull request, CI and publish halves are already timed by their GitHub runs (joshuafolkken/kit#7540).
// `run_ship_lap.timed` is not reused: it only writes the lane ledger inside a ship stage and prints
// nothing, so a release outside any stage would get no line from it.

const STEP = {
	WORKTREE: 'work tree and install',
	COMMIT: 'commit',
	PUSH: 'push',
} as const

const FAILED_SUFFIX = ' (failed)'

interface StepClock {
	now: () => number
	print: (line: string) => void
}

function monotonic_now(): number {
	return performance.now()
}

function print_info(line: string): void {
	console.info(line)
}

const DEFAULT_CLOCK: StepClock = { now: monotonic_now, print: print_info }

function step_line(step: string, elapsed_ms: number, is_failed: boolean): string {
	const suffix = is_failed ? FAILED_SUFFIX : ''

	return `⏱️ Release ${step}: ${time_format.format_seconds(elapsed_ms)}${suffix}`
}

// A step that threw still prints the time it ran before failing, then its error goes on unchanged.
async function timed<T>(
	step: string,
	run: () => Promise<T>,
	clock: StepClock = DEFAULT_CLOCK,
): Promise<T> {
	const started_ms = clock.now()
	const outcome = { is_failed: true }

	try {
		const result = await run()

		outcome.is_failed = false

		return result
	} finally {
		clock.print(step_line(step, clock.now() - started_ms, outcome.is_failed))
	}
}

const release_step_time = { STEP, timed }

export type { StepClock }
export { release_step_time }
