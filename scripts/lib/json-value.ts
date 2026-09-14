// Reading JSON that may not be JSON (joshuafolkken/kit#1151).
//
// Four readers under `scripts/` parse text that a defect, a truncated write or an older format can
// make unparseable — a transcript line, a settings file, an MCP declaration — and every one of them
// answers "could not read this" rather than throwing, because a single bad line must not fail a
// whole report. They had begun to carry a copy of the same try/catch each; this is the one copy.

function parse_or_undefined(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}

// A plain object, as opposed to an array or a primitive. `typeof null` is `'object'`, and an array
// answers `'object'` too, so both have to be excluded by hand before a key lookup means anything.
function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const json_value = { parse_or_undefined, is_record }

export { json_value }
