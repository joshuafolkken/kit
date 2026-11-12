import { review_readers_scan } from './review-readers-scan'

// The per-file outline of a unified diff (joshuafolkken/kit#5547): added and deleted lines, the hunks,
// each hunk's new-side line range, and the top-level declarations it touches — the declaration
// heading the hunk (git's `@@ … @@ <context>`) and any declaration an added or removed line writes.
// Pure: `diff-summary-cli.ts` reads the diff and saves it whole.

const FILE_HEADER = /^diff --git a\/.* b\/(?<file>.*)$/u
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(?<start>\d+)(?:,(?<count>\d+))? @@ ?(?<context>.*)$/u
const CHANGED_LINE = /^[+-]/u
const ADDED = '+'
const NONE = '—'
const LIST_SEPARATOR = ', '
const TABLE_HEAD =
	'| file | + | - | hunks | ranges | declarations |\n| --- | --- | --- | --- | --- | --- |'

interface FileSummary {
	file: string
	added: number
	deleted: number
	ranges: Array<string>
	declarations: Array<string>
}

function blank(file: string): FileSummary {
	return { file, added: 0, deleted: 0, ranges: [], declarations: [] }
}

function to_range(start: number, count: number): string {
	return count <= 1 ? String(start) : `${String(start)}-${String(start + count - 1)}`
}

function add_declarations(summary: FileSummary, text: string): void {
	const names = review_readers_scan.declarations(text).map((declaration) => declaration.name)

	summary.declarations = [...new Set([...summary.declarations, ...names])]
}

function read_hunk(summary: FileSummary, groups: Record<string, string | undefined>): void {
	const count = groups['count'] === undefined ? 1 : Number(groups['count'])

	summary.ranges.push(to_range(Number(groups['start']), count))
	add_declarations(summary, groups['context'] ?? '')
}

function read_changed(summary: FileSummary, line: string): void {
	if (line.startsWith(ADDED)) summary.added += 1
	else summary.deleted += 1
	add_declarations(summary, line.slice(1))
}

// A `+` / `-` line counts only after the file's first hunk header — the `--- a/` and `+++ b/` lines
// above it are the file's own header.
function is_changed(summary: FileSummary, line: string): boolean {
	return summary.ranges.length > 0 && CHANGED_LINE.test(line)
}

function read_body(current: FileSummary | undefined, line: string): void {
	if (current === undefined) return

	const hunk = HUNK_HEADER.exec(line)?.groups

	if (hunk !== undefined) read_hunk(current, hunk)
	else if (is_changed(current, line)) read_changed(current, line)
}

function read_line(files: Array<FileSummary>, line: string): void {
	const file = FILE_HEADER.exec(line)?.groups?.['file']

	if (file === undefined) read_body(files.at(-1), line)
	else files.push(blank(file))
}

function parse(diff: string): Array<FileSummary> {
	const files: Array<FileSummary> = []

	for (const line of diff.split('\n')) read_line(files, line)

	return files
}

function listed(values: ReadonlyArray<string>): string {
	return values.length === 0 ? NONE : values.join(LIST_SEPARATOR)
}

function to_row(summary: FileSummary): string {
	const { file, added, deleted, ranges, declarations } = summary
	const cells = [`\`${file}\``, `+${String(added)}`, `-${String(deleted)}`, String(ranges.length)]

	return `| ${[...cells, listed(ranges), listed(declarations)].join(' | ')} |`
}

// The full diff's path is the last line, the way a verification command ends on its `full output:`.
function report(diff: string, base: string, saved_path: string): string {
	const files = parse(diff)

	if (files.length === 0) return `diff:summary: no changes against ${base}`

	return [
		TABLE_HEAD,
		...files.map((summary) => to_row(summary)),
		`full output: ${saved_path}`,
	].join('\n')
}

const diff_summary = { parse, report }

export type { FileSummary }
export { diff_summary }
