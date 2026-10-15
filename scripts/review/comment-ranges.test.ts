import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { comment_ranges } from './comment-ranges'

// joshuafolkken/kit#3826: round 2 is skipped for a fix that changed only comments, decided by
// comparing the comment-free text of a file before and after the fixes. **The dangerous direction is
// a false "same"** — a real edit stripped as if it were a comment would skip the review of code — so
// most cases below pin an edit that must survive the strip.

function strip(text: string, is_svelte = false): string | undefined {
	return comment_ranges.strip(ts, text, is_svelte)
}

function is_same_code(before: string, after: string, is_svelte = false): boolean {
	const stripped = strip(before, is_svelte)

	return stripped !== undefined && stripped === strip(after, is_svelte)
}

const CODE = ['const value = 1', '', 'function read(): number {', '\treturn value', '}', ''].join(
	'\n',
)

describe('comment_ranges.strip — a comment-only edit reads as the same code', () => {
	it('treats an added line comment as no change', () => {
		const after = CODE.replace('function read', '// Why it reads.\nfunction read')

		expect(is_same_code(CODE, after)).toBe(true)
	})

	it('treats an added trailing comment as no change', () => {
		expect(is_same_code(CODE, CODE.replace('= 1', '= 1 // the default'))).toBe(true)
	})

	it('treats an indented comment and a JSDoc block as no change', () => {
		const after = CODE.replace('\treturn', '\t// Explained.\n\treturn').replace(
			'function',
			'/**\n * Reads it. // not a line comment\n */\nfunction',
		)

		expect(is_same_code(CODE, after)).toBe(true)
	})

	it('treats a reworded comment as no change', () => {
		expect(is_same_code(`// one\n${CODE}`, `// two\n${CODE}`)).toBe(true)
	})

	it('treats an inline block comment between tokens as no change', () => {
		expect(is_same_code('call(a, b)\n', 'call(a, /* why */ b)\n')).toBe(true)
	})
})

describe('comment_ranges.strip — an edit to code is never stripped', () => {
	it('keeps a changed code line', () => {
		expect(is_same_code(CODE, CODE.replace('= 1', '= 2'))).toBe(false)
	})

	it('keeps a `//` inside a string literal', () => {
		expect(is_same_code("const url = 'http://a'\n", "const url = 'http://b'\n")).toBe(false)
	})

	it('keeps a `//` inside a template literal after a substitution', () => {
		const before = 'const text = `${prefix} // one`\n'

		expect(is_same_code(before, before.replace('one', 'two'))).toBe(false)
	})

	// A pattern-based scanner reads `\//` as the start of a line comment and drops the rest of the line.
	it('keeps the code after a regular expression ending in an escaped slash', () => {
		const before = 'const pattern = /a\\//u; const limit = 1\n'

		expect(is_same_code(before, before.replace('= 1', '= 2'))).toBe(false)
	})

	// A `//` inside a JSDoc comment must not run past its `*/` into the code on the same line.
	it('keeps the code after a JSDoc block on the same line', () => {
		const before = '/** see // here */ const limit = 1\n'

		expect(is_same_code(before, before.replace('= 1', '= 2'))).toBe(false)
	})

	it('keeps a changed shebang, which decides how the file runs', () => {
		expect(is_same_code(`#!/usr/bin/env node\n${CODE}`, `#!/usr/bin/env tsx\n${CODE}`)).toBe(false)
	})

	it('keeps a blank line added to a template literal', () => {
		expect(is_same_code('const text = `a\nb`\n', 'const text = `a\n\nb`\n')).toBe(false)
	})

	it('answers undefined for a file that does not parse', () => {
		expect(strip('const = = 1\n')).toBeUndefined()
	})

	// JSX text holding `//` would read as a comment; parsed as TypeScript it is a parse error instead.
	it('answers undefined for JSX, whose text a trivia read could mistake for a comment', () => {
		expect(strip('const view = <p>// text</p>\n')).toBeUndefined()
	})
})

describe('comment_ranges.strip — a block comment spanning lines', () => {
	// A line break inside a block comment ends `return`, so the two return different values.
	it('keeps the line break it puts after `return`', () => {
		const before = 'function read(): unknown {\n\treturn /* a\n\tb */ 1\n}\n'

		expect(is_same_code(before, before.replace('a\n\tb', 'a b'))).toBe(false)
	})

	it('treats a JSDoc block reflowed onto one line as no change', () => {
		const before = `/**\n * Reads it.\n */\n${CODE}`

		expect(is_same_code(before, `/** Reads it. */\n${CODE}`)).toBe(true)
	})
})

// A directive is read by lint, the type checker or a bundler, so adding one is an edit to code.
describe('comment_ranges.strip — a directive comment is code', () => {
	it.each([
		'// eslint-disable-next-line no-console',
		'// @ts-expect-error',
		'/// <reference types="node" />',
		'/* v8 ignore next */',
		'/** @type {number} */',
	])('keeps an added `%s`', (directive) => {
		expect(is_same_code(CODE, `${directive}\n${CODE}`)).toBe(false)
	})

	it('keeps an added `/*#__PURE__*/` annotation', () => {
		expect(is_same_code(CODE, CODE.replace('= 1', '= /*#__PURE__*/ 1'))).toBe(false)
	})
})

const COMPONENT = [
	'<script lang="ts">',
	'\tlet count = 0',
	'</script>',
	'',
	'<p>{count}</p>',
	'',
	'<style>',
	'\tp { color: red; }',
	'</style>',
	'',
].join('\n')

describe('comment_ranges.strip — a Svelte component', () => {
	it('treats a comment added to the script block as no change', () => {
		const after = COMPONENT.replace('\tlet', '\t// Starts at zero.\n\tlet')

		expect(is_same_code(COMPONENT, after, true)).toBe(true)
	})

	it('treats a markup comment as no change', () => {
		expect(is_same_code(COMPONENT, COMPONENT.replace('<p>', '<!-- note -->\n<p>'), true)).toBe(true)
	})

	it('keeps an added `<!-- svelte-ignore -->`', () => {
		const after = COMPONENT.replace(
			'<p>',
			'<!-- svelte-ignore a11y_no_static_element_interactions -->\n<p>',
		)

		expect(is_same_code(COMPONENT, after, true)).toBe(false)
	})

	it('keeps a changed script line', () => {
		expect(is_same_code(COMPONENT, COMPONENT.replace('= 0', '= 1'), true)).toBe(false)
	})

	it('keeps a changed markup line', () => {
		expect(is_same_code(COMPONENT, COMPONENT.replace('{count}', '{count + 1}'), true)).toBe(false)
	})

	it('keeps a style block whole, a `<!--` in it included', () => {
		const before = COMPONENT.replace('p {', '<!-- p {')

		expect(is_same_code(before, before.replace('red', 'blue'), true)).toBe(false)
	})

	it('answers undefined when a script block does not parse', () => {
		expect(strip(COMPONENT.replace('= 0', '= ='), true)).toBeUndefined()
	})
})
