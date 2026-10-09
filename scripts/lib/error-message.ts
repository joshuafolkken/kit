// The one place a caught value becomes the text a report shows: an `Error` contributes its own message,
// anything else thrown is stringified as it stands.
function message_of(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

const DEBUG_ENV_KEY = 'JOSH_DEBUG'

// A catch that folds a failure into a state verdict — "dirty", "not merged", "not written" — leaves no
// trace of why by default, so a wrong verdict cannot be followed back to its cause.
// `JOSH_DEBUG` set to any non-blank value writes the swallowed reason to stderr; unset, nothing changes.
function trace_swallowed(where: string, error: unknown): void {
	if ((process.env[DEBUG_ENV_KEY] ?? '').trim() === '') return

	process.stderr.write(`josh debug: ${where}: ${message_of(error)}\n`)
}

const error_text = { message_of, trace_swallowed }

export { error_text }
