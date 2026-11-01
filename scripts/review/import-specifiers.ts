import type { TypeScriptApi } from './comment-ranges'

// A script's text with every binding import's module specifier emptied, so two versions that differ
// only in where a binding comes from read as the same text (joshuafolkken/kit#5789).
//
// **The bindings stay**: a renamed or added binding still changes the text. **A side-effect import is
// kept whole** — `import './x'` binds nothing, and its path alone decides what runs. Ranges come from
// the parse tree, never a pattern, and a `.svelte` file is returned as it is.

type Range = readonly [number, number]

const VIRTUAL_FILE_NAME = 'import-delta.ts'
const SVELTE_EXTENSION = '.svelte'
const EMPTY_SPECIFIER = "''"

function specifier_ranges(api: TypeScriptApi, text: string): ReadonlyArray<Range> {
	const source = api.createSourceFile(VIRTUAL_FILE_NAME, text, api.ScriptTarget.Latest, true)

	return source.statements
		.filter((statement) => api.isImportDeclaration(statement))
		.filter((statement) => statement.importClause !== undefined)
		.map((statement) => [statement.moduleSpecifier.getStart(source), statement.moduleSpecifier.end])
}

function blank(api: TypeScriptApi, text: string, relative: string): string {
	if (relative.endsWith(SVELTE_EXTENSION)) return text

	const ranges = specifier_ranges(api, text)
	const starts = [0, ...ranges.map(([, end]) => end)]

	return starts
		.map((start, index) => text.slice(start, ranges[index]?.[0] ?? text.length))
		.join(EMPTY_SPECIFIER)
}

const import_specifiers = { blank }

export { import_specifiers }
