import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { json_value } from './json-value'

const record_schema = z.object({ issue: z.number(), note: z.string().optional() })

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

describe('json_value.parse_with — JSON read against a schema', () => {
	it('reads text the schema accepts as the parsed value', () => {
		expect(json_value.parse_with('{"issue":7,"note":"a"}', record_schema)).toEqual({
			issue: 7,
			note: 'a',
		})
	})

	it.each([
		['empty text', ''],
		['an object cut short', '{"issue":'],
		['prose', 'no braces here'],
	])('reads %s as undefined without throwing', (_label, text) => {
		expect(json_value.parse_with(text, record_schema)).toBeUndefined()
	})

	it.each([
		['a field of the wrong type', '{"issue":"7"}'],
		['a missing required field', '{"note":"a"}'],
		['an array', '[1]'],
		['JSON null', 'null'],
	])('reads %s as undefined when the schema rejects it', (_label, text) => {
		expect(json_value.parse_with(text, record_schema)).toBeUndefined()
	})

	it('never lets a defaulting schema stand in for text that is not JSON', () => {
		const defaulting = z.object({ issue: z.number() }).default({ issue: 0 })

		expect(json_value.parse_with('not json', defaulting)).toBeUndefined()
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
