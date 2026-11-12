import { readFileSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { json_value } from '#scripts/lib/json-value'
import { package_manifest } from '#scripts/lib/package-manifest'
import { parse, type ParseError } from 'jsonc-parser'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { read_document } from './ai-document-fixture'

// The package settings reference and the full example must name exactly the `josh.*` settings the
// schemas in `package-manifest.ts` read, both ways (joshuafolkken/kit#7358): a setting added to a
// schema without a row on the page, or a key in the example, fails, and so does one nothing reads.
// Both are held to the same list, walked from the schemas, so the page and the example cannot disagree.
const REFERENCE = 'docs/package-settings.md'
const EXAMPLE = 'package.json.full-example.jsonc'
// An array's elements share one path: `josh.gate.steps[].name`.
const ELEMENT = '[]'
// A reference row opens with the setting's full path in a code span.
const REFERENCE_ROW = /^\| `(josh\.[\w.[\]]+)`/gmu

interface ParsedExample {
	value: unknown
	errors: ReadonlyArray<ParseError>
}

function by_name(left: string, right: string): number {
	return left.localeCompare(right)
}

function child(parent: string, key: string): string {
	return parent === '' ? key : `${parent}.${key}`
}

function sorted_unique(paths: ReadonlyArray<string>): Array<string> {
	return [...new Set(paths)].toSorted(by_name)
}

// Optional and defaulted wrappers leave a setting's path as it is.
function unwrapped(schema: z.core.$ZodType): z.core.$ZodType {
	let inner = schema

	while (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault) inner = inner.unwrap()

	return inner
}

// An array's own path, then its elements' fields: a list of plain values has no fields, so its own row
// documents it.
function array_paths(at: string, element_paths: ReadonlyArray<string>): Array<string> {
	return [at, ...element_paths.filter((element) => element !== `${at}${ELEMENT}`)]
}

// Every path but an object's own: an object is documented by its fields.
function schema_paths(schema: z.core.$ZodType, at: string): Array<string> {
	const inner = unwrapped(schema)

	if (inner instanceof z.ZodObject) {
		return Object.entries(inner.shape).flatMap(([key, field]) =>
			schema_paths(field, child(at, key)),
		)
	}

	if (inner instanceof z.ZodArray) {
		return array_paths(at, schema_paths(inner.element, `${at}${ELEMENT}`))
	}

	return [at]
}

function value_paths(value: unknown, at: string): Array<string> {
	if (Array.isArray(value)) {
		return array_paths(
			at,
			value.flatMap((item: unknown) => value_paths(item, `${at}${ELEMENT}`)),
		)
	}

	if (json_value.is_record(value)) {
		return Object.entries(value).flatMap(([key, field]) => value_paths(field, child(at, key)))
	}

	return [at]
}

function setting_paths(): Array<string> {
	const schemas = Object.values(package_manifest.josh_schemas)

	return sorted_unique(schemas.flatMap((schema) => schema_paths(schema, '')))
}

function documented_settings(text: string): Array<string> {
	return [...text.matchAll(REFERENCE_ROW)].map((match) => match[1] ?? '').toSorted(by_name)
}

function read_example(): ParsedExample {
	const errors: Array<ParseError> = []
	const value: unknown = parse(readFileSync(package_file(EXAMPLE), 'utf8'), errors)

	return { value, errors }
}

function rejecting_schemas(value: unknown): Array<string> {
	return Object.entries(package_manifest.josh_schemas)
		.filter(([, schema]) => !schema.safeParse(value).success)
		.map(([name]) => name)
}

describe('the package settings reference', () => {
	it('documents exactly the josh.* settings the schemas read', () => {
		expect(documented_settings(read_document(REFERENCE))).toStrictEqual(setting_paths())
	})

	it('gives each setting one row', () => {
		const documented = documented_settings(read_document(REFERENCE))

		expect(documented).toStrictEqual([...new Set(documented)])
	})

	it('reads a row path and skips a path in prose', () => {
		const text = '| `josh.gate.steps[].name` | yes |\nSet `josh.format` too.'

		expect(documented_settings(text)).toStrictEqual(['josh.gate.steps[].name'])
	})
})

describe('the full package.json example', () => {
	it('parses once its comments are dropped', () => {
		expect(read_example().errors).toStrictEqual([])
	})

	it('is read by every josh schema', () => {
		expect(rejecting_schemas(read_example().value)).toStrictEqual([])
	})

	it('names exactly the josh.* settings the schemas read', () => {
		const named = value_paths(read_example().value, '')

		expect(sorted_unique(named)).toStrictEqual(setting_paths())
	})
})

describe('the setting path walk', () => {
	it('walks objects, arrays and wrappers to the same paths a value has', () => {
		const step = z.strictObject({ cores: z.int(), paths: z.array(z.string()) })
		const steps = z.array(step).default([])
		const josh = z.object({ name: z.string().optional(), steps }).optional()
		const schema = z.object({ josh })
		const steps_value = [
			{ cores: 1, paths: ['a'] },
			{ cores: 2, paths: ['b'] },
		]
		const value = { josh: { name: 'a', steps: steps_value } }
		const expected = ['josh.name', 'josh.steps', 'josh.steps[].cores', 'josh.steps[].paths']

		expect(schema_paths(schema, '')).toStrictEqual(expected)
		expect(sorted_unique(value_paths(value, ''))).toStrictEqual(expected)
	})
})
