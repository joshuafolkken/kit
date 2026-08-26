import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parse_json_array_or_undefined, parse_json_array_safe } from './parse-json-array'

const element_schema = z.object({ id: z.number(), name: z.string() })
// Valid JSON, but not a listing — what `gh` prints when it answers an error instead of results.
const NOT_AN_ARRAY = '{"message":"nope"}'

describe('parse_json_array_safe', () => {
	it('parses a valid JSON array into a typed array', () => {
		const raw = JSON.stringify([
			{ id: 1, name: 'a' },
			{ id: 2, name: 'b' },
		])

		expect(parse_json_array_safe(raw, element_schema)).toEqual([
			{ id: 1, name: 'a' },
			{ id: 2, name: 'b' },
		])
	})

	it('returns an empty array for an empty JSON array', () => {
		expect(parse_json_array_safe('[]', element_schema)).toEqual([])
	})

	it('returns an empty array when the JSON is malformed (SyntaxError)', () => {
		expect(parse_json_array_safe('not json', element_schema)).toEqual([])
	})

	it('returns an empty array for a truncated JSON payload', () => {
		expect(parse_json_array_safe('[{"id":1,', element_schema)).toEqual([])
	})

	it('rethrows when the parsed value violates the schema', () => {
		const raw = JSON.stringify([{ id: 'not-a-number', name: 'a' }])

		expect(() => parse_json_array_safe(raw, element_schema)).toThrow(z.ZodError)
	})

	it('rethrows when the parsed value is not an array', () => {
		const raw = JSON.stringify({ id: 1, name: 'a' })

		expect(() => parse_json_array_safe(raw, element_schema)).toThrow(z.ZodError)
	})
})

// joshuafolkken/kit#950: `parse_json_array_safe` answers `[]` for a response that is not JSON at all,
// which a caller cannot tell from an empty listing. `epic:bundle` read an unparseable epic listing as
// "no epics are open" and recommended creating one over an issue an epic already tracked —
// confidently, and with exit 0. This variant keeps the two apart.
describe('parse_json_array_or_undefined', () => {
	it('parses a valid JSON array the same way', () => {
		const raw = JSON.stringify([{ id: 1, name: 'a' }])

		expect(parse_json_array_or_undefined(raw, element_schema)).toEqual([{ id: 1, name: 'a' }])
	})

	// The distinction the whole variant exists for: both are empty to `parse_json_array_safe`.
	it('separates an empty listing from a response it could not parse', () => {
		expect(parse_json_array_or_undefined('[]', element_schema)).toEqual([])
		expect(parse_json_array_or_undefined('not json', element_schema)).toBeUndefined()
		expect(parse_json_array_safe('not json', element_schema)).toEqual([])
	})

	// A schema mismatch still throws, as it does in the safe variant: a shape change stays visible
	// rather than degrading into "could not read".
	it('rethrows a schema mismatch rather than reporting it as unparseable', () => {
		expect(() => parse_json_array_or_undefined('[{"id":"x"}]', element_schema)).toThrow()
	})

	// Valid JSON that is not a listing — `gh` answering an error object rather than an array. Left to
	// the schema it throws a ZodError out of the command, which is a stack trace where the documented
	// answer is "could not list the open epics". It is a gap, not a shape change in the elements.
	it('reads a JSON value that is not an array as unreadable', () => {
		expect(
			parse_json_array_or_undefined('{"message":"API rate limit exceeded"}', element_schema),
		).toBeUndefined()
		expect(parse_json_array_or_undefined('null', element_schema)).toBeUndefined()
	})

	// The one branch on which the two deliberately disagree. The safe variant still throws on a JSON
	// value that is not an array, so a `gh` field that changed shape stays visible to its callers;
	// this variant reads the same response as a gap, because its caller reports gaps.
	it('differs from the safe variant on a JSON value that is not an array', () => {
		expect(() => parse_json_array_safe(NOT_AN_ARRAY, element_schema)).toThrow()
		expect(parse_json_array_or_undefined(NOT_AN_ARRAY, element_schema)).toBeUndefined()
	})
})
