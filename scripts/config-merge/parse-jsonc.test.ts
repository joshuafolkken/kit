import { describe, expect, it } from 'vitest'
import { parse_jsonc } from './parse-jsonc'

const URL_VALUE = 'https://example.com/a/*b*/'

describe('parse_jsonc — tolerated JSONC syntax', () => {
	it('reads a document carrying line and block comments', () => {
		const source = '{\n\t// line\n\t"a": 1, /* block */\n\t"b": [2]\n}\n'

		expect(parse_jsonc(source)).toStrictEqual({ a: 1, b: [2] })
	})

	it('accepts trailing commas in objects and arrays', () => {
		expect(parse_jsonc('{ "a": [1, 2,], "b": { "c": true, }, }')).toStrictEqual({
			a: [1, 2],
			b: { c: true },
		})
	})

	it('keeps comment-like text inside a string value', () => {
		expect(parse_jsonc(`{ "url": "${URL_VALUE}" }`)).toStrictEqual({ url: URL_VALUE })
	})

	it('reads a plain JSON document unchanged', () => {
		expect(parse_jsonc('{"a":false,"b":"x"}')).toStrictEqual({ a: false, b: 'x' })
	})

	// `JSON.parse` keeps a `__proto__` key as an own property; assigning it instead would make it the
	// prototype, and the spread-and-stringify write-back would then silently drop it from the file.
	it('keeps a nested __proto__ key as data that survives a stringify round trip', () => {
		const source = '{ "config": { "__proto__": { "k": 1 } } }'

		expect(JSON.stringify(parse_jsonc(source))).toBe(JSON.stringify(JSON.parse(source)))
	})
})

describe('parse_jsonc — rejected input', () => {
	it.each(['{ "a": }', '{ "a": 1', '', '{ "a": 1 } trailing'])(
		'throws on malformed %j',
		(source) => {
			expect(() => parse_jsonc(source)).toThrow()
		},
	)

	it.each(['[1, 2]', '"text"', '42', 'null'])('throws on the non-object top level %j', (source) => {
		expect(() => parse_jsonc(source)).toThrow()
	})
})
