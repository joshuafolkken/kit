import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { issue_body_keys } from './issue-body-keys'

const DOCUMENT_ROOT = path.join(
	import.meta.dirname,
	'..',
	'..',
	'prompts',
	'collaboration-workflow',
)
const ENCODING = 'utf8'
const JAPANESE = readFileSync(path.join(DOCUMENT_ROOT, 'issue-template.md'), ENCODING)
const ENGLISH_TEMPLATE = 'issue-template.en.md'
const ENGLISH = readFileSync(path.join(DOCUMENT_ROOT, ENGLISH_TEMPLATE), ENCODING)
const TEMPLATE_FENCE = '````'
const HEADING_PREFIX = '## '
const CELL_SEPARATOR = '|'
// A declaration key as the template writes it: `- <key>:` inside a code span.
const DECLARATION_KEY = /`- (?<key>[^:`]+):/gu
const KINDS = { keys: 'key', values: 'value', headings: 'heading' } as const
const KIND_NAMES: ReadonlySet<string> = new Set(Object.values(KINDS))

function template_lines(document: string): ReadonlyArray<string> {
	const lines = document.split('\n')
	const start = lines.findIndex((line) => line.startsWith(TEMPLATE_FENCE))
	const end = lines.findIndex((line, index) => index > start && line.trim() === TEMPLATE_FENCE)

	return lines.slice(start + 1, end)
}

function template_headings(document: string): ReadonlyArray<string> {
	return template_lines(document)
		.filter((line) => line.startsWith(HEADING_PREFIX))
		.map((line) => line.slice(HEADING_PREFIX.length))
}

// The correspondence table's rows as `<kind>: <ja> = <en>`.
function table_rows(): ReadonlyArray<string> {
	return ENGLISH.split('\n')
		.map((line) => line.split(CELL_SEPARATOR).map((cell) => cell.trim()))
		.filter((cells) => KIND_NAMES.has(cells[1] ?? ''))
		.map((cells) => `${String(cells[1])}: ${String(cells[2])} = ${String(cells[3])}`)
}

function expected_rows(): ReadonlyArray<string> {
	return Object.entries(KINDS).flatMap(([table, kind]) =>
		Object.values(issue_body_keys.TABLES[table as keyof typeof KINDS]).map(
			(row) => `${kind}: ${row.ja} = ${row.en}`,
		),
	)
}

function english_heading(japanese: string): string {
	const row = Object.values(issue_body_keys.TABLES.headings).find((entry) => entry.ja === japanese)

	return row?.en ?? japanese
}

describe(ENGLISH_TEMPLATE, () => {
	it('holds a correspondence table row for every row of issue-body-keys.ts, and no other', () => {
		expect(table_rows()).toStrictEqual(expected_rows())
	})

	it('writes the Japanese template headings in the en column, in the same order', () => {
		expect(template_headings(ENGLISH)).toStrictEqual(
			template_headings(JAPANESE).map((heading) => english_heading(heading)),
		)
	})

	it('names only declaration keys of the en column in its template', () => {
		const english_keys: ReadonlySet<string> = new Set(
			Object.values(issue_body_keys.TABLES.keys).map((row) => row.en),
		)
		const named = [...template_lines(ENGLISH).join('\n').matchAll(DECLARATION_KEY)].map(
			(match) => match.groups?.['key'],
		)

		expect(named.filter((key) => key === undefined || !english_keys.has(key))).toStrictEqual([])
		expect(named.length).toBeGreaterThan(0)
	})
})
