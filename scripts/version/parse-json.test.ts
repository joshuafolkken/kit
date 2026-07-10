import { describe, expect, it } from 'vitest'
import { safe_json_parse } from './parse-json'

describe('safe_json_parse', () => {
	it('parses valid JSON into its value', () => {
		expect(safe_json_parse('{"version":"1.2.3"}')).toStrictEqual({ version: '1.2.3' })
	})

	it('returns undefined for malformed JSON instead of throwing', () => {
		expect(safe_json_parse('{ not json')).toBeUndefined()
	})

	it('returns undefined for an empty string', () => {
		expect(safe_json_parse('')).toBeUndefined()
	})
})
