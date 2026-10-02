// The one place a caught value becomes the text a report shows: an `Error` contributes its own message,
// anything else thrown is stringified as it stands.
function message_of(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

const error_text = { message_of }

export { error_text }
