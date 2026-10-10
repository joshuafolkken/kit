import type { z } from 'zod'

// Reading JSON that may not be JSON.
//
// Readers under `scripts/` parse text that a defect, a truncated write or an older format can make
// unparseable — a transcript line, a settings file, an MCP declaration, a lock record, CLI output —
// and every one of them answers "could not read this" rather than throwing, because a single bad line
// must not fail a whole report. They had begun to carry a copy of the same try/catch each; this is the
// one copy, and `is_record` beside it is the one object test.

function parse_or_undefined(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}

// The same read with a shape asked of it: text that is not JSON and JSON the schema rejects both
// answer `undefined`, which is what a best-effort reader of a record, a payload or CLI output wants.
// A reader that must tell the two apart, or keep a shape change visible, is `parse-json-array.ts`.
function parse_with<T>(text: string, schema: z.ZodType<T>): T | undefined {
	const value = parse_or_undefined(text)
	if (value === undefined) return undefined

	const parsed = schema.safeParse(value)

	return parsed.success ? parsed.data : undefined
}

// A plain object, as opposed to an array or a primitive. `typeof null` is `'object'`, and an array
// answers `'object'` too, so both have to be excluded by hand before a key lookup means anything.
function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const json_value = { parse_or_undefined, parse_with, is_record }

export { json_value }
