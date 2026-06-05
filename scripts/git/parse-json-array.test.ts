import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parse_json_array_safe } from './parse-json-array'

const element_schema = z.object({ id: z.number(), name: z.string() })

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
