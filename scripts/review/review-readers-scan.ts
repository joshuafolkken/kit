// The exported names a diff edits, read from one file's `git diff -U0` and its new text
// (joshuafolkken/kit#4515). Pure: `review-untouched-readers.ts` reads the diff and searches each name.
//
// **A name is edited when a changed line falls inside its top-level declaration** — from the
// declaration's first line to the line before the next one. Only a name another module can reach is
// returned, spelled the way a reader writes it: a direct export as itself, a member of an exported
// namespace object (`export { issue_merged }`) as `issue_merged.read_merged`. The namespace object
// itself is skipped — a member added to it changes none of its readers.

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(?<start>\d+)(?:,(?<count>\d+))? @@/u
const DECLARATION =
	/^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+(?<name>\w+)/u
const EXPORT_LIST = /^export\s+(?:type\s+)?\{(?<names>[^}]*)\}/gmu
const IDENTIFIER = /^(?:type\s+)?(?<name>\w+)/u
const DIRECT_EXPORT = /^export\s/u
const LIST_SEPARATOR = ','
// A blank line or a comment line — `//`, `/*`, or a block comment's ` *` continuation.
const PREAMBLE = /^(?:\s*$|\s*\/[/*]|\s+\*)/u
// From a 1-based line number to the index of the line above it.
const TWO = 2

interface Declaration {
	name: string
	line: number
	is_exported: boolean
}

interface Edited {
	// The spelling a reader uses — `name` or `namespace.member`.
	target: string
	line: number
}

function to_range(start: number, count: number): Array<number> {
	return Array.from({ length: count }, (_unused, offset) => start + offset)
}

// A pure deletion (`+c,0`) is placed on the line before it, which still lies inside the declaration
// it was cut from.
function hunk_lines(header: string): Array<number> {
	const groups = HUNK_HEADER.exec(header)?.groups

	if (groups === undefined) return []

	const start = Number(groups['start'])
	const count = groups['count'] === undefined ? 1 : Number(groups['count'])

	return count === 0 ? [start] : to_range(start, count)
}

function changed_lines(diff: string): Array<number> {
	return diff.split('\n').flatMap((line) => hunk_lines(line))
}

function to_declaration(text: string, index: number): Declaration | undefined {
	const name = DECLARATION.exec(text)?.groups?.['name']

	if (name === undefined) return undefined

	return { name, line: index + 1, is_exported: DIRECT_EXPORT.test(text) }
}

function declarations(source: string): Array<Declaration> {
	const found = source.split('\n').map((text, index) => to_declaration(text, index))

	return found.filter((entry): entry is Declaration => entry !== undefined)
}

function first_identifier(entry: string): string | undefined {
	return IDENTIFIER.exec(entry.trim())?.groups?.['name']
}

function list_names(list: string): Array<string> {
	const names = list.split(LIST_SEPARATOR).map((entry) => first_identifier(entry))

	return names.filter((name): name is string => name !== undefined)
}

function exported_names(source: string): Set<string> {
	const lists = [...source.matchAll(EXPORT_LIST)].map((match) => match.groups?.['names'] ?? '')

	return new Set(lists.flatMap((list) => list_names(list)))
}

// The members of `const <name> = { … }`, or `undefined` where `name` is not an object literal. `name`
// is a `\w+` match, so it carries no pattern syntax.
function namespace_members(source: string, name: string): Array<string> | undefined {
	const literal = new RegExp(String.raw`^const\s+${name}\s*=\s*\{(?<body>[^}]*)\}`, 'mu')
	const body = literal.exec(source)?.groups?.['body']

	return body === undefined ? undefined : list_names(body)
}

function namespaces(source: string, exported: ReadonlySet<string>): Map<string, Array<string>> {
	const entries = [...exported].map((name) => [name, namespace_members(source, name)] as const)

	return new Map(
		entries.filter((entry): entry is [string, Array<string>] => entry[1] !== undefined),
	)
}

// The line after a declaration's own text: the next declaration's line, moved back past the blank and
// comment lines that introduce it — a comment edited above `b` edits `b`, not the `a` before it.
function range_end(texts: ReadonlyArray<string>, next: number | undefined): number {
	if (next === undefined) return Infinity

	let end = next

	while (end > 1 && PREAMBLE.test(texts[end - TWO] ?? '')) end -= 1

	return end
}

function touched(source: string, lines: ReadonlySet<number>): Array<Declaration> {
	const found = declarations(source)
	const texts = source.split('\n')

	return found.filter((declaration, index) => {
		const end = range_end(texts, found[index + 1]?.line)

		return [...lines].some((line) => line >= declaration.line && line < end)
	})
}

function namespace_of(
	name: string,
	spaces: ReadonlyMap<string, ReadonlyArray<string>>,
): string | undefined {
	return [...spaces].find(([, members]) => members.includes(name))?.[0]
}

interface ExportView {
	exported: ReadonlySet<string>
	spaces: ReadonlyMap<string, ReadonlyArray<string>>
}

function target_of(declaration: Declaration, view: ExportView): string | undefined {
	const { name } = declaration

	if (view.spaces.has(name)) return undefined
	if (declaration.is_exported || view.exported.has(name)) return name

	const space = namespace_of(name, view.spaces)

	return space === undefined ? undefined : `${space}.${name}`
}

function edited(source: string, diff: string): Array<Edited> {
	const exported = exported_names(source)
	const view = { exported, spaces: namespaces(source, exported) }
	const edited_declarations = touched(source, new Set(changed_lines(diff)))
	const found_targets = edited_declarations.map((declaration) => ({
		target: target_of(declaration, view),
		line: declaration.line,
	}))

	return found_targets.filter((entry): entry is Edited => entry.target !== undefined)
}

const review_readers_scan = { changed_lines, edited }

export type { Edited }
export { review_readers_scan }
