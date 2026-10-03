import { describe, expect, it } from 'vitest'
import { json_value } from './json-value'

describe('json_value.parse_or_undefined — one JSON Lines line', () => {
	it('reads a well-formed line as its value', () => {
		expect(json_value.parse_or_undefined('{"kind":"merge","pos":1}')).toEqual({
			kind: 'merge',
			pos: 1,
		})
	})

	it.each([
		['an empty line', ''],
		['a whitespace-only line', ' \t '],
		['a truncated object', '{"kind":"mer'],
		['plain text', 'not json'],
	])('reads %s as undefined rather than throwing', (_label, line) => {
		expect(json_value.parse_or_undefined(line)).toBeUndefined()
	})

	it('reads a line carrying a trailing carriage return as its value', () => {
		expect(json_value.parse_or_undefined('{"a":1}\r')).toEqual({ a: 1 })
	})

	it('reads the empty piece a trailing newline leaves after a split as undefined', () => {
		const values = '{"a":1}\n{"b":2}\n'
			.split('\n')
			.map((line) => json_value.parse_or_undefined(line))

		expect(values).toEqual([{ a: 1 }, { b: 2 }, undefined])
	})
})

describe('json_value.is_record', () => {
	it.each([
		['a plain object', { a: 1 }, true],
		['an array', [1], false],
		// eslint-disable-next-line unicorn/no-null -- JSON `null` answers typeof 'object' and must be excluded
		['null', null, false],
		['undefined', undefined, false],
		['a string', 'a', false],
	])('answers %s', (_label, value, expected) => {
		expect(json_value.is_record(value)).toBe(expected)
	})
})
