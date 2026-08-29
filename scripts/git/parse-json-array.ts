import type { z } from 'zod'

// Marks input that is not JSON at all, letting each caller pick its own empty value. Schema
// mismatches are deliberately not folded in here: those rethrow, so a shape change stays visible
// instead of silently degrading to a fallback.
const MALFORMED_JSON = Symbol('malformed-json')

function parse_json_loose(raw_json: string): unknown {
	try {
		return JSON.parse(raw_json)
	} catch (error) {
		if (error instanceof SyntaxError) return MALFORMED_JSON
		throw error
	}
}

/**
 * Parse a JSON string into an array validated by the given element schema.
 * Malformed JSON yields undefined, so a caller can tell it apart from an empty listing.
 *
 * `parse_json_array_safe` answers `[]` for both, which reads as "there is nothing" — and a command
 * that acts on that reports a confident absence built on a response it could not parse
 * (joshuafolkken/kit#950).
 */
function parse_json_array_or_undefined<T>(
	raw_json: string,
	element_schema: z.ZodType<T>,
): Array<T> | undefined {
	const value = parse_json_loose(raw_json)
	// Not an array at all — `gh` answering `{"message":"API rate limit exceeded"}` rather than a
	// listing. That is the same kind of gap as unparseable output, not a change in the shape of the
	// elements, so it reads as unreadable instead of throwing out of the command.
	if (value === MALFORMED_JSON || !Array.isArray(value)) return undefined

	return element_schema.array().parse(value)
}

// What one listing read produced. The two gaps are deliberately apart: JSON that is not a listing at
// all is an access or connectivity problem, while elements the schema rejects mean the tool's fields
// changed — and those send a reader to two different places (joshuafolkken/kit#996). A caller that
// treats them the same still reads them from here rather than writing the try/catch again.
type ListingRead<T> =
	{ kind: 'read'; rows: Array<T> } | { kind: 'unreadable' } | { kind: 'unexpected_shape' }

/**
 * Parse a listing, telling the two gaps apart.
 *
 * The rethrow `parse_json_array_or_undefined` performs is the whole point, and every caller that
 * wants both gaps named was catching it itself — the `auto-ok` pickup and `epic:next`'s
 * repository-level busy check wrote the same six lines (joshuafolkken/kit#925).
 */
function read_json_listing<T>(raw_json: string, element_schema: z.ZodType<T>): ListingRead<T> {
	try {
		const rows = parse_json_array_or_undefined(raw_json, element_schema)

		return rows === undefined ? { kind: 'unreadable' } : { kind: 'read', rows }
	} catch {
		return { kind: 'unexpected_shape' }
	}
}

/**
 * Parse a JSON string into an array validated by the given element schema.
 * Malformed JSON yields an empty array.
 *
 * Deliberately **not** `parse_json_array_or_undefined(...) ?? []`, near-identical though the bodies
 * are. The two differ on the branch that matters: valid JSON that is not an array throws here, so a
 * `gh` field that changed shape stays visible, while the variant above reads it as a gap. Folding
 * them together silences that throw for every existing caller (joshuafolkken/kit#950).
 */
function parse_json_array_safe<T>(raw_json: string, element_schema: z.ZodType<T>): Array<T> {
	const value = parse_json_loose(raw_json)
	if (value === MALFORMED_JSON) return []

	return element_schema.array().parse(value)
}

/**
 * Parse a JSON string into a single object validated by the given schema.
 * Malformed JSON yields undefined.
 */
function parse_json_object_safe<T>(raw_json: string, schema: z.ZodType<T>): T | undefined {
	const value = parse_json_loose(raw_json)
	if (value === MALFORMED_JSON) return undefined

	return schema.parse(value)
}

const parse_json = {
	parse_json_array_safe,
	parse_json_array_or_undefined,
	parse_json_object_safe,
	read_json_listing,
}

export type { ListingRead }
export {
	parse_json,
	parse_json_array_or_undefined,
	parse_json_array_safe,
	parse_json_object_safe,
	read_json_listing,
}
