// A stand-in for execa's `execaSync` that keeps the one property a `gh` caller's contract rests on:
// **a non-zero exit throws unless the spawn said `reject: false`**, carrying the captured streams on
// the error the way `ExecaSyncError` does.
//
// A bare `vi.fn()` returning `{ exitCode: 1 }` answers a failed spawn as a value whichever way it was
// asked, so a caller that spawns `gh` with `reject: false` and a caller that goes through
// `git_gh_exec` (which lets execa throw) cannot be pinned by the same test. With this stand-in they
// can: the test queues what gh did on `outcomes` and the caller sees what real execa would hand it,
// which is what lets a direct spawn be replaced by the shared wrapper under unchanged tests.
//
// It imports nothing from `execa`, so a `vi.mock('execa', …)` factory can load it.

interface SpawnOutcome {
	exitCode?: number
	stdout?: string
	stderr?: string
	shortMessage?: string
}

type SpawnOutcomes = (file: string, args: ReadonlyArray<string>, options?: unknown) => unknown

const SUCCESS_EXIT_CODE = 0

function is_outcome(value: unknown): value is SpawnOutcome {
	return typeof value === 'object' && value !== null
}

function does_reject(options: unknown): boolean {
	return !is_outcome(options) || Reflect.get(options, 'reject') !== false
}

function to_spawn_error(outcome: SpawnOutcome): Error {
	const exit_code = String(outcome.exitCode)
	const message = outcome.shortMessage ?? `Command failed with exit code ${exit_code}`

	return Object.assign(new Error(message), outcome)
}

// What the caller receives for one queued outcome: the outcome itself, or the error execa would
// have thrown in its place. An absent exit code is a failure too — it is how execa reports a spawn
// that never ran (no `gh` on PATH), which throws exactly like a non-zero exit unless told not to.
function settle(outcome: unknown, options: unknown): unknown {
	if (!is_outcome(outcome)) return outcome
	const has_failed = outcome.exitCode !== SUCCESS_EXIT_CODE

	if (has_failed && does_reject(options)) throw to_spawn_error(outcome)

	return outcome
}

function honoring_reject(outcomes: SpawnOutcomes): SpawnOutcomes {
	return function execa_sync(
		file: string,
		args: ReadonlyArray<string>,
		options?: unknown,
	): unknown {
		return settle(outcomes(file, args, options), options)
	}
}

const gh_execa_fixture = { honoring_reject }

export { gh_execa_fixture }
