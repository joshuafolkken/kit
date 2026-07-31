import type { z } from 'zod'

/**
 * Parse a JSON string into an array validated by the given element schema.
 * Tolerates malformed JSON by returning an empty array; rethrows any other
 * error (e.g. schema validation failures) unchanged.
 */
function parse_json_array_safe<T>(raw_json: string, element_schema: z.ZodType<T>): Array<T> {
	try {
		return element_schema.array().parse(JSON.parse(raw_json))
	} catch (error) {
		if (error instanceof SyntaxError) return []
		throw error
	}
}

/**
 * Parse a JSON string into a single object validated by the given schema.
 * Tolerates malformed JSON by returning undefined; rethrows any other error
 * (e.g. schema validation failures) unchanged.
 */
function parse_json_object_safe<T>(raw_json: string, schema: z.ZodType<T>): T | undefined {
	try {
		return schema.parse(JSON.parse(raw_json))
	} catch (error) {
		if (error instanceof SyntaxError) return undefined
		throw error
	}
}

export { parse_json_array_safe, parse_json_object_safe }
