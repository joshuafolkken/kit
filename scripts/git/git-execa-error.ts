// Extract the exit code from a thrown execa error. Returns the numeric exit code,
// or undefined when the process was terminated by a signal or failed to spawn.
function get_exit_code(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null) return undefined
	if (!('exitCode' in error)) return undefined

	const { exitCode: exit_code } = error

	return typeof exit_code === 'number' ? exit_code : undefined
}

// Whether execa killed this spawn on its own budget, which is the only reliable way to tell a
// timeout from any other non-zero exit — a killed process writes nothing of its own, so a hang that
// had printed one line first would otherwise be reported as whatever that line happened to say.
//
// It lives here rather than beside either caller because both `gh` and `git push` now pass a
// timeout, and a second copy of the same three lines is the duplication `CLAUDE.md` prohibits
// (joshuafolkken/kit#1251).
function has_timed_out(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false
	if (!('timedOut' in error)) return false

	return error.timedOut === true
}

// The error a spawned git command fails with. The exit code is carried on `cause` as well as in the
// message, because callers branch on it rather than parse it: `git_command.push` reads 128 there to
// decide whether to retry with `--set-upstream`.
function create_spawn_error(command: string, exit_code: number | undefined): Error {
	const exit_code_string = exit_code === undefined ? 'unknown' : String(exit_code)
	const error_message = `git ${command} exited with code ${exit_code_string}`

	return new Error(error_message, { cause: { exit_code: exit_code_string } })
}

export { create_spawn_error, get_exit_code, has_timed_out }
