import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ESLINT_CACHE_FLAGS, ESLINT_RELATED_CACHE_FLAGS } from './josh/josh-command-types'
import { lint_related_scope } from './lint-related-scope'

// joshuafolkken/kit#1298: what this file decides is which files reach prettier and eslint, and a
// narrowed run that silently checked nothing would look exactly like a clean one. The extension
// set, both linters' argument lists and the printed line are asserted here.

const ROOT = path.resolve('/repo')
const SOURCE_FILE = path.join(ROOT, 'scripts', 'thing.ts')
const DOCUMENT_FILE = path.join(ROOT, 'docs', 'thing.md')
const FILES: ReadonlyArray<string> = [SOURCE_FILE, DOCUMENT_FILE]
const IMAGE_FILE = path.join(ROOT, 'static', 'logo.png')
const WHOLE_TREE = '.'

function present(): boolean {
	return true
}

describe('lint_related_scope.is_lintable', () => {
	it.each(['a.ts', 'a.svelte', 'a.md', 'a.yaml', 'a.json', 'a.css'])('accepts %j', (file) => {
		expect(lint_related_scope.is_lintable(file)).toBe(true)
	})

	it.each(['a.png', 'a.lock', 'a.woff2', 'Makefile'])('rejects %j', (file) => {
		expect(lint_related_scope.is_lintable(file)).toBe(false)
	})
})

describe('lint_related_scope.scope_inputs', () => {
	it('narrows to the changed files the linters read', () => {
		const inputs = lint_related_scope.scope_inputs(present)

		expect(inputs.is_selectable(SOURCE_FILE)).toBe(true)
		expect(inputs.is_selectable(IMAGE_FILE)).toBe(false)
	})

	it('names its own reason, so a fallback is not read as the sibling command reporting one', () => {
		expect(lint_related_scope.scope_inputs(present).nothing_reason).toBe(
			lint_related_scope.NOTHING_LINTABLE_REASON,
		)
	})
})

describe('lint_related_scope.prettier_arguments', () => {
	it('checks the given files rather than the tree', () => {
		const args = lint_related_scope.prettier_arguments(FILES)

		expect(args).toContain('--check')
		expect(args.slice(-FILES.length)).toEqual([...FILES])
		expect(args).not.toContain(WHOLE_TREE)
	})

	it('skips a file prettier cannot parse instead of failing on it', () => {
		expect(lint_related_scope.prettier_arguments(FILES)).toContain('--ignore-unknown')
	})
})

describe('lint_related_scope.eslint_arguments', () => {
	it('lints the given files rather than the tree', () => {
		const args = lint_related_scope.eslint_arguments(FILES)

		expect(args).toContain(SOURCE_FILE)
		expect(args).not.toContain(WHOLE_TREE)
	})

	it('stays silent about a file eslint has no configuration for', () => {
		expect(lint_related_scope.eslint_arguments(FILES)).toContain('--no-warn-ignored')
	})

	// joshuafolkken/kit#1347: this command is called between edits while `josh gate` lints the whole
	// tree beside the review, and each eslint run rewrites its cache file whole from the copy it loaded
	// at start-up — so on one file the run that finished last discarded the other's entries. The
	// location is asserted as a pair with its flags rather than by membership: a flag and its value are
	// one unit, and a membership check passes on an order that would make eslint read
	// `--cache-strategy` as the location.
	//
	// The gate's location is excluded by comparing the argument itself rather than a substring of the
	// joined line: `.eslintcache.related` has `.eslintcache` as a prefix, so a substring check can
	// never fail and would assert nothing.
	it('keeps a cache of its own, which a concurrent gate run cannot overwrite', () => {
		const args = lint_related_scope.eslint_arguments(FILES)

		expect(args.join(' ')).toContain(ESLINT_RELATED_CACHE_FLAGS.join(' '))
		expect(args).not.toContain(ESLINT_CACHE_FLAGS.at(-1))
	})
})

describe('lint_related_scope.describe_scope', () => {
	it('says it narrowed, and to what', () => {
		const description = lint_related_scope.describe_scope(
			{ mode: 'related', files: [SOURCE_FILE], reason: '1 changed file(s)' },
			ROOT,
		)

		expect(description).toContain(lint_related_scope.COMMAND_LABEL)
		expect(description).toContain(path.join('scripts', 'thing.ts'))
	})

	it('says it fell back to the whole tree rather than reporting a narrowed run', () => {
		const description = lint_related_scope.describe_scope(
			{ mode: 'all', files: [], reason: lint_related_scope.NOTHING_LINTABLE_REASON },
			ROOT,
		)

		expect(description).toContain('checking the whole tree instead')
	})
})
