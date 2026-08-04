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

export type { SpawnResult }
export { resolve_spawn_exit, SIGNAL_KILL_EXIT_CODE, SPAWN_ERROR_EXIT_CODE }
