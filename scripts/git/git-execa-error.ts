// Extract the exit code from a thrown execa error. Returns the numeric exit code,
// or undefined when the process was terminated by a signal or failed to spawn.
function get_exit_code(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null) return undefined
	if (!('exitCode' in error)) return undefined

	const { exitCode: exit_code } = error

	return typeof exit_code === 'number' ? exit_code : undefined
}

export { get_exit_code }
