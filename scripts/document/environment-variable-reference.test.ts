import { readdirSync, readFileSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { describe, expect, it } from 'vitest'
import { read_document } from './ai-document-fixture'

// The environment variable reference must list exactly the `JOSH_*` variables the code reads, both
// ways: a new variable without a row fails, and so does a row for a variable nothing reads any more
// (joshuafolkken/kit#2991). Every variable the code reads is named by one single-quoted string
// literal — the `*_KEY = 'JOSH_…'` constant its reader passes to the environment — while a name in a
// comment is backticked, so the literal is the read and nothing else is.
const REFERENCE = 'docs/environment-variables.md'
const SOURCE_ROOTS: ReadonlyArray<string> = ['scripts', 'ports', 'env', 'eslint']
const SOURCE_FILE = /\.(?:ts|js)$/u
const TEST_SUFFIX = '.test.ts'
const KEY_LITERAL = /'(JOSH_[A-Z0-9_]+)'/gu
// A reference row opens with the variable's name in a code span.
const REFERENCE_ROW = /^\| `(JOSH_[A-Z0-9_]+)`/gmu

function by_name(left: string, right: string): number {
	return left.localeCompare(right)
}

function source_files(root: string): Array<string> {
	return readdirSync(package_file(root), { encoding: 'utf8', recursive: true })
		.filter((entry) => SOURCE_FILE.test(entry) && !entry.endsWith(TEST_SUFFIX))
		.map((entry) => package_file(`${root}/${entry}`))
}

function key_literals(text: string): Array<string> {
	return [...text.matchAll(KEY_LITERAL)].map((match) => match[1] ?? '')
}

function code_variables(): Array<string> {
	const files = SOURCE_ROOTS.flatMap((root) => source_files(root))
	const names = files.flatMap((file) => key_literals(readFileSync(file, 'utf8')))

	return [...new Set(names)].toSorted(by_name)
}

function documented_variables(text: string): Array<string> {
	return [...text.matchAll(REFERENCE_ROW)].map((match) => match[1] ?? '').toSorted(by_name)
}

describe('the environment variable reference', () => {
	it('documents exactly the JOSH_* variables the code reads', () => {
		expect(documented_variables(read_document(REFERENCE))).toStrictEqual(code_variables())
	})

	it('gives each variable one row', () => {
		const documented = documented_variables(read_document(REFERENCE))

		expect(documented).toStrictEqual([...new Set(documented)])
	})

	// The scan is only worth keeping if it sees the read and ignores the comment.
	it('reads a key literal and skips a backticked mention', () => {
		expect(key_literals("const KEY = 'JOSH_EXAMPLE' // see `JOSH_OTHER`")).toStrictEqual([
			'JOSH_EXAMPLE',
		])
	})

	it('reads a row name and skips a name in prose', () => {
		const text = '| `JOSH_EXAMPLE` | yes |\nSet `JOSH_OTHER` too.'

		expect(documented_variables(text)).toStrictEqual(['JOSH_EXAMPLE'])
	})
})
