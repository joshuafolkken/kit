const SPAWN_ERROR_EXIT_CODE = 2
const SIGNAL_KILL_EXIT_CODE = 1

interface SpawnResult {
	exitCode?: number | undefined
	isTerminated?: boolean
	shortMessage?: string | undefined
}

// A numeric exit code — zero or not — means the command ran; return it verbatim.
// `exitCode: undefined` means it never produced one: either a true spawn failure
// (the replacement for spawnSync's `result.error`) or a signal kill. Only the
// former is reported as a spawn error; a signal kill falls back to 1, matching the
// previous `result.status ?? 1`.
function resolve_spawn_exit(executable: string, result: SpawnResult): number {
	if (result.exitCode !== undefined) return result.exitCode
	if (result.isTerminated === true) return SIGNAL_KILL_EXIT_CODE

	console.error(`Failed to execute ${executable}: ${result.shortMessage ?? 'spawn failed'}`)

	return SPAWN_ERROR_EXIT_CODE
}

// execa's types declare `stdout` as `string`, but a spawn failure (the executable missing from
// PATH) leaves it `undefined` at runtime — the same declared-vs-actual gap `resolve_spawn_exit`
// covers for `exitCode`. Reading it through a signature that admits the real shape keeps the guard
// honest: a plain `result.stdout ?? ''` is reported as an unnecessary condition against the lying
// type, and dereferencing it unguarded crashes the caller.
function read_spawn_stdout(result: { stdout?: string }): string {
	return result.stdout ?? ''
}

// Same declared-vs-actual gap as `read_spawn_stdout`, for the stream that carries git's and gh's
// failure messages.
function read_spawn_stderr(result: { stderr?: string }): string {
	return result.stderr ?? ''
}

export type { SpawnResult }
export {
	read_spawn_stderr,
	read_spawn_stdout,
	resolve_spawn_exit,
	SIGNAL_KILL_EXIT_CODE,
	SPAWN_ERROR_EXIT_CODE,
}
