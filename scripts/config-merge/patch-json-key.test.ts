import { describe, expect, it } from 'vitest'
import { parse_jsonc } from './parse-jsonc'
import { patch_json_key } from './patch-json-key'
import { prettier_format_json } from './prettier-json-fixture'

const HEADER_COMMENT = '// Path aliases are handled by svelte.config.js'
const INLINE_COMMENT = '// enable once the JS helpers are typed'
const EXCLUDE_KEY = 'exclude'
const EXTENDS_KEY = 'extends'
const COMPILER_OPTIONS_KEY = 'compilerOptions'
const SVELTE_KIT_PRESET = './.svelte-kit/tsconfig.json'
const TRAILING_NOTE = '// keep this note'
const CRLF_DOCUMENT = '{\r\n\t"a": 1\r\n}\r\n'
const BASE_PRESET_DOCUMENT = `{\n\t"${EXTENDS_KEY}": ["./base.json"]\n}\n`

// Shaped like a tsconfig.json `sv create` produces: comments above a key and inside a nested object,
// which the whole-file write-back this module replaced used to delete (#798).
const COMMENTED_TSCONFIG = `{
	"${EXTENDS_KEY}": ["${SVELTE_KIT_PRESET}"],
	"${COMPILER_OPTIONS_KEY}": {
		"strict": true
		${INLINE_COMMENT}
	},
	${HEADER_COMMENT}
	"${EXCLUDE_KEY}": ["node_modules"]
}
`

function set_exclude(values: ReadonlyArray<string>): string {
	return patch_json_key.set_json_key(COMMENTED_TSCONFIG, EXCLUDE_KEY, values)
}

describe('patch_json_key.set_json_key', () => {
	it('keeps every comment in the document', () => {
		const result = set_exclude(['node_modules', 'build'])

		expect(result).toContain(HEADER_COMMENT)
		expect(result).toContain(INLINE_COMMENT)
	})

	it('rewrites only the targeted value, leaving sibling keys byte-identical', () => {
		const result = set_exclude(['node_modules', 'build'])

		expect(result).toContain(`"${EXTENDS_KEY}": ["${SVELTE_KIT_PRESET}"],`)
		expect(result).toContain(`"${EXCLUDE_KEY}": ["node_modules", "build"]`)
	})

	// jsonc-parser's own formatter would have expanded this array one entry per line, and prettier's
	// `json` printer wants it inline — the reason the library never renders a value here (#797).
	it('emits a short array inline, the way prettier wants it', async () => {
		const result = set_exclude(['a', 'b'])

		expect(result).toContain(`"${EXCLUDE_KEY}": ["a", "b"]`)
		expect(await prettier_format_json(result)).toBe(result)
	})

	// The comma after a non-last key is one column, and it decides a borderline line. Measuring the
	// value without it emitted this `extends` array inline at 101 columns, which prettier then broke —
	// so kit wrote a file that failed the consumer's own `prettier --check`.
	it('counts the comma after a non-last key when deciding whether the value fits', async () => {
		const at_the_boundary = [
			'./node_modules/@joshuafolkken/kit/tsconfig/base.json',
			SVELTE_KIT_PRESET,
		]
		const result = patch_json_key.set_json_key(COMMENTED_TSCONFIG, EXTENDS_KEY, at_the_boundary)

		expect(result).toContain(`"${EXTENDS_KEY}": [\n`)
		expect(await prettier_format_json(result)).toBe(result)
	})

	it('breaks an over-width array the way prettier would', () => {
		const long = Array.from(
			{ length: 8 },
			(_value, index) => `./a/long/path/segment-${String(index)}`,
		)
		const result = patch_json_key.set_json_key(COMMENTED_TSCONFIG, EXCLUDE_KEY, long)

		expect(result).toContain(`"${EXCLUDE_KEY}": [\n\t\t"./a/long/path/segment-0",`)
	})
})

describe('patch_json_key.set_json_key — placement', () => {
	it('appends an absent key aligned with its siblings', () => {
		const result = patch_json_key.set_json_key(BASE_PRESET_DOCUMENT, EXCLUDE_KEY, ['dist'])

		expect(result).toBe(
			`{\n\t"${EXTENDS_KEY}": ["./base.json"],\n\t"${EXCLUDE_KEY}": ["dist"]\n}\n`,
		)
	})

	it('adds the first key to an empty object', () => {
		const result = patch_json_key.set_json_key('{}\n', EXCLUDE_KEY, ['dist'])

		expect(result).toBe(`{\n\t"${EXCLUDE_KEY}": ["dist"]\n}\n`)
	})

	it('matches the indentation a space-indented document uses', () => {
		const content = `{\n  "${EXTENDS_KEY}": ["./base.json"]\n}\n`
		const result = patch_json_key.set_json_key(content, EXCLUDE_KEY, ['dist'])

		expect(result).toContain(`,\n  "${EXCLUDE_KEY}": ["dist"]`)
	})

	// A value that breaks across lines is rendered with tabs by the kit-preset serializer. Splicing
	// that into a space-indented document left mixed indentation, which the consumer's own prettier
	// rewrote — so the file kit had just written failed their format check.
	it('re-indents a multi-line value for a space-indented document', () => {
		const content = `{\n  "${EXTENDS_KEY}": ["./base.json"]\n}\n`
		const long = Array.from({ length: 8 }, (_v, index) => `./a/long/path/segment-${String(index)}`)
		const result = patch_json_key.set_json_key(content, EXCLUDE_KEY, long)

		expect(result).toContain('\n    "./a/long/path/segment-0",')
		expect(result).not.toContain('\t')
	})

	// The comma belongs right after the value, but the new key belongs after the whole line —
	// otherwise it slides in front of a trailing comment and steals it.
	it('inserts after a trailing comment rather than in front of it', () => {
		const content = `{\n\t"a": 1 ${TRAILING_NOTE}\n}\n`
		const result = patch_json_key.set_json_key(content, EXCLUDE_KEY, ['dist'])

		expect(result).toBe(`{\n\t"a": 1, ${TRAILING_NOTE}\n\t"${EXCLUDE_KEY}": ["dist"]\n}\n`)
	})
})

describe('patch_json_key.set_json_key — separators', () => {
	// JSONC permits a trailing comma and `parse_jsonc` accepts one, so adding a second produced `,,`
	// and left the consumer with a config file nothing could read.
	it('does not add a second comma when the last property already has one', () => {
		const result = patch_json_key.set_json_key('{\n\t"a": 1,\n}\n', EXCLUDE_KEY, ['dist'])

		expect(result).not.toContain(',,')
		expect(parse_jsonc(result)).toStrictEqual({ a: 1, [EXCLUDE_KEY]: ['dist'] })
	})

	it('is not fooled by a comma inside a trailing comment', () => {
		const result = patch_json_key.set_json_key('{\n\t"a": 1 // note, really\n}\n', EXCLUDE_KEY, [
			'dist',
		])

		expect(parse_jsonc(result)).toStrictEqual({ a: 1, [EXCLUDE_KEY]: ['dist'] })
	})

	// The value was laid out when nothing followed it; appending a key adds a comma to that line, and
	// one column is enough to push an inlined array past printWidth. Prettier would then break a line
	// kit had just written, so the gaining property is re-laid-out.
	it('re-lays-out the previous last value once a comma follows it', async () => {
		const content = `{\n\t"${EXTENDS_KEY}": [\n\t\t"./node_modules/@joshuafolkken/kit/tsconfig/base.json",\n\t\t"${SVELTE_KIT_PRESET}"\n\t]\n}\n`
		const result = patch_json_key.set_json_key(content, EXCLUDE_KEY, ['dist'])

		expect(await prettier_format_json(result)).toBe(result)
	})

	// That re-layout must never reach a value spanning several lines: serializing it back from the
	// parsed form would delete the comments inside it, which is the defect this module prevents.
	it('leaves a multi-line previous value and its comments alone', () => {
		const content = `{\n\t"${COMPILER_OPTIONS_KEY}": {\n\t\t"strict": true\n\t\t${INLINE_COMMENT}\n\t}\n}\n`
		const result = patch_json_key.set_json_key(content, EXCLUDE_KEY, ['dist'])

		expect(result).toContain(INLINE_COMMENT)
		expect(result).toContain(`{\n\t\t"strict": true\n\t\t${INLINE_COMMENT}\n\t},`)
	})
})

describe('patch_json_key.set_json_key — document edges', () => {
	it('adds a trailing newline to a document that lacked one', () => {
		const result = patch_json_key.set_json_key(`{"${EXTENDS_KEY}": ["a"]}`, EXTENDS_KEY, ['b'])

		expect(result.endsWith('\n')).toBe(true)
	})

	it('appends inside the braces of a single-line document', () => {
		const result = patch_json_key.set_json_key(`{"${EXTENDS_KEY}": ["a"]}`, EXCLUDE_KEY, ['dist'])

		expect(result).toBe(`{"${EXTENDS_KEY}": ["a"],\n"${EXCLUDE_KEY}": ["dist"]}\n`)
	})

	// An object whose body is only a comment still has a comment to lose. Rewriting the braces
	// wholesale — the one whole-region edit this module used to make — dropped it.
	it('keeps a comment-only body when adding the first key', () => {
		const result = patch_json_key.set_json_key(`{\n\t${TRAILING_NOTE}\n}\n`, EXCLUDE_KEY, ['dist'])

		expect(result).toBe(`{\n\t${TRAILING_NOTE}\n\t"${EXCLUDE_KEY}": ["dist"]\n}\n`)
	})

	// A CRLF checkout must not come back with mixed endings; the whole-file serializer this replaced
	// always produced a uniform file.
	it('splices with the line ending the document already uses', () => {
		const result = patch_json_key.set_json_key(CRLF_DOCUMENT, EXCLUDE_KEY, ['dist'])

		expect(result).toBe(`{\r\n\t"a": 1,\r\n\t"${EXCLUDE_KEY}": ["dist"]\r\n}\r\n`)
	})

	// The rendered value carries its own newlines once it breaks across lines, and those come from a
	// serializer that only ever emits LF — so the multi-line case is where mixed endings appear.
	it('uses the document line ending inside a multi-line value too', () => {
		const long = Array.from({ length: 8 }, (_v, index) => `./a/long/path/segment-${String(index)}`)
		const result = patch_json_key.set_json_key(CRLF_DOCUMENT, EXCLUDE_KEY, long)

		expect(result.replaceAll('\r\n', '')).not.toContain('\n')
	})

	it('leaves a document it cannot parse as an object untouched', () => {
		expect(patch_json_key.set_json_key('[1, 2]', EXCLUDE_KEY, ['a'])).toBe('[1, 2]')
	})
})

const SURVIVING_PROPERTY = '\t"b": ["x"]'
const ONLY_SURVIVOR_DOCUMENT = `{\n${SURVIVING_PROPERTY}\n}\n`
const SOLE_PROPERTY_DOCUMENT = '{\n\t"a": 1\n}\n'

describe('patch_json_key.remove_json_key', () => {
	it('removes a middle key and the comments belonging to the rest survive', () => {
		const result = patch_json_key.remove_json_key(COMMENTED_TSCONFIG, COMPILER_OPTIONS_KEY)

		expect(parse_jsonc(result)).toStrictEqual({
			[EXTENDS_KEY]: [SVELTE_KIT_PRESET],
			[EXCLUDE_KEY]: ['node_modules'],
		})
		expect(result).toContain(HEADER_COMMENT)
	})

	it('removes the first key without stranding its comma', () => {
		const content = `{\n\t"a": 1,\n${SURVIVING_PROPERTY}\n}\n`

		expect(patch_json_key.remove_json_key(content, 'a')).toBe(ONLY_SURVIVOR_DOCUMENT)
	})

	// Removing the first key used to span up to the next key, which swallowed the comment describing
	// that next key — the same silent deletion this module exists to prevent.
	it('removes the first key while keeping the comment that documents the next one', () => {
		const content = `{\n\t"a": 1,\n\t${TRAILING_NOTE}\n${SURVIVING_PROPERTY}\n}\n`

		expect(patch_json_key.remove_json_key(content, 'a')).toBe(
			`{\n\t${TRAILING_NOTE}\n${SURVIVING_PROPERTY}\n}\n`,
		)
	})

	it('removes a first key that shares its line with the rest of the document', () => {
		expect(patch_json_key.remove_json_key('{"a": 1, "b": 2}\n', 'a')).toBe('{ "b": 2}\n')
	})
})

describe('patch_json_key.remove_json_key — comment boundaries', () => {
	// A comment closing the removed key's line annotates that key. Stranding it left an orphan line
	// that both mis-attributes the note and fails the consumer's own formatting check.
	it('removes a trailing comment on the first key line along with it', () => {
		const content = `{\n\t"a": 1, ${TRAILING_NOTE}\n${SURVIVING_PROPERTY}\n}\n`

		expect(patch_json_key.remove_json_key(content, 'a')).toBe(ONLY_SURVIVOR_DOCUMENT)
	})

	// The separator is found with the JSONC scanner, so a comma written inside a comment between two
	// properties is not mistaken for one — truncating that comment left an unreadable document.
	it('is not fooled by a comma inside a comment between two keys', () => {
		const content = `{\n\t"a": 1,\n\t// one, two\n${SURVIVING_PROPERTY}\n}\n`
		const result = patch_json_key.remove_json_key(content, 'a')

		expect(parse_jsonc(result)).toStrictEqual({ b: ['x'] })
	})

	// Removing the LAST key reaches back for the comma before it, and the previous key's own trailing
	// note sits between the two. A single span back to that comma deleted a comment belonging to a
	// property that is staying, while the removed key's own note was left behind to re-attach to it.
	it('keeps the previous key trailing note and takes the removed key own', () => {
		const content = `{\n\t"a": 1, ${TRAILING_NOTE}\n\t"b": 2 // goes with b\n}\n`
		const result = patch_json_key.remove_json_key(content, 'b')

		expect(result).toBe(`{\n\t"a": 1 ${TRAILING_NOTE}\n}\n`)
	})

	// A middle key has a comma on both sides; taking one from each end would leave the surviving keys
	// with nothing between them, so the trailing one goes with the line and the leading one keeps its
	// job.
	it('removes a middle key while keeping the keys on either side separated', () => {
		const result = patch_json_key.remove_json_key('{\n\t"a": 1,\n\t"b": 2,\n\t"c": 3\n}\n', 'b')

		expect(result).toBe('{\n\t"a": 1,\n\t"c": 3\n}\n')
	})
})

describe('patch_json_key.remove_json_key — re-layout', () => {
	// Removing the last key hands a column back to the one before it, which now ends the object — the
	// mirror of the append path's re-layout, and the same `prettier --check` failure if skipped.
	it('re-lays-out the new last value once its comma is gone', async () => {
		const wrapped = `{\n\t"${EXTENDS_KEY}": [\n\t\t"./node_modules/@joshuafolkken/kit/tsconfig/base.json",\n\t\t"${SVELTE_KIT_PRESET}"\n\t],\n\t"${COMPILER_OPTIONS_KEY}": { "strict": true }\n}\n`
		const result = patch_json_key.remove_json_key(wrapped, COMPILER_OPTIONS_KEY)

		expect(result).toContain(`"${EXTENDS_KEY}": ["`)
		expect(await prettier_format_json(result)).toBe(result)
	})

	// A `/* ... */` comment fits on one line, so "single line" was never the safe test for whether
	// re-laying-out a value would delete the consumer's note.
	it('never re-lays-out a value holding a block comment', () => {
		const result = patch_json_key.remove_json_key('{\n\t"a": [1 /* keep */],\n\t"z": 2\n}\n', 'z')

		expect(result).toContain('/* keep */')
	})

	it('leaves no stray blank line when removing a first key in a CRLF document', () => {
		const result = patch_json_key.remove_json_key('{\r\n\t"a": 1,\r\n\t"b": 2\r\n}\r\n', 'a')

		expect(result).toBe('{\r\n\t"b": 2\r\n}\r\n')
	})

	// A comment sitting above the removed key documents that key. Leaving it behind silently
	// re-attaches the consumer's note to whichever key ends up first — a mis-attribution in the one
	// module whose whole purpose is comment fidelity.
	it('removes the comment above the first key along with it', () => {
		const content = `{\n\t${TRAILING_NOTE}\n\t"a": 1,\n${SURVIVING_PROPERTY}\n}\n`

		expect(patch_json_key.remove_json_key(content, 'a')).toBe(ONLY_SURVIVOR_DOCUMENT)
	})

	it('removes the last key without stranding its comma', () => {
		const content = `{\n${SURVIVING_PROPERTY},\n\t"a": 1\n}\n`

		expect(patch_json_key.remove_json_key(content, 'a')).toBe(ONLY_SURVIVOR_DOCUMENT)
	})
})

describe('patch_json_key.remove_json_key — degenerate documents', () => {
	it('leaves an empty object when the only key is removed', () => {
		expect(patch_json_key.remove_json_key(SOLE_PROPERTY_DOCUMENT, 'a')).toBe('{}\n')
	})

	it('is a no-op for a key that is not present', () => {
		expect(patch_json_key.remove_json_key(SOLE_PROPERTY_DOCUMENT, 'missing')).toBe(
			SOLE_PROPERTY_DOCUMENT,
		)
	})
})
