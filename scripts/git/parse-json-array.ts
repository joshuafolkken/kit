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
 * Malformed JSON yields an empty array.
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
	parse_json_object_safe,
}

export { parse_json, parse_json_array_safe, parse_json_object_safe }
