import type ts from 'typescript'

// The text of a source file with its comments taken out, so two versions that differ only in comments
// read as the same text.
//
// **Every range comes from the TypeScript parser, never from a pattern.** A `//` inside a regular
// expression or a template literal is code, and a hand-written scanner that took it for a comment
// would strip a real edit and call the fix comment-only — the one wrong answer that buys a `skip`.
// Driven by the parse tree, a range is only ever read from the trivia before a token.
//
// **What it cannot read, it does not strip**: a file that does not parse answers `undefined`, and a
// comment the walk does not reach stays in the text. Both resolve to "the code changed", which costs a
// round rather than skipping one.

type TypeScriptApi = typeof ts
type Range = readonly [number, number]

// A comment's own opening — the shebang is trivia to the parser too, but it decides how the file is
// executed, so it stays.
const COMMENT_OPENINGS: ReadonlyArray<string> = ['//', '/*']
// A private-use character, which no source file this reads holds.
const MARK = ''
const LINE_BREAK = '\n'
const SEPARATOR = ' '
// Script blocks are parsed; style blocks are left whole, so `<!--` in a stylesheet is never read as
// a markup comment.
const RAW_BLOCK = /<(?<tag>script|style)\b[^>]*>(?<body>[\s\S]*?)<\/\k<tag>>/gu
const SCRIPT_TAG = 'script'
const MARKUP_COMMENT = /<!--[\s\S]*?-->/gu
const VIRTUAL_FILE_NAME = 'fix-delta.ts'
// A comment a tool reads is code: a fix that silences lint, the type check or coverage, or changes
// what a bundler or the type checker reads, does it by adding one — the edit only the review sees.
// JSDoc type tags count too, since a checked `.js` file takes its types from them. Matching too much
// only costs a round.
const DIRECTIVE_MARKERS: ReadonlyArray<string> = [
	'///',
	'@ts-',
	'eslint',
	'jshint',
	'global ',
	'globals ',
	'prettier-ignore',
	'svelte-ignore',
	'cspell',
	'v8 ignore',
	'c8 ignore',
	'istanbul ignore',
	'__PURE__',
	'__NO_SIDE_EFFECTS__',
	'@vite-ignore',
	'webpack',
	'@jsx',
	'@vitest-environment',
]
const JSDOC_TYPE_TAG =
	/@(?:type|typedef|param|returns?|template|satisfies|import|callback|overload|enum|this)\b/u

function is_directive(text: string, range: Range): boolean {
	const comment = text.slice(range[0], range[1])

	if (JSDOC_TYPE_TAG.test(comment)) return true

	return DIRECTIVE_MARKERS.some((marker) => comment.includes(marker))
}

function is_comment(text: string, range: Range): boolean {
	return COMMENT_OPENINGS.some((opening) => text.startsWith(opening, range[0]))
}

function trivia_at(api: TypeScriptApi, text: string, position: number): Array<Range> {
	const found = [
		...(api.getLeadingCommentRanges(text, position) ?? []),
		...(api.getTrailingCommentRanges(text, position) ?? []),
	]

	return found.map((range): Range => [range.pos, range.end])
}

// **JSDoc nodes are not descended into**: their children sit inside the comment, and a `//` there
// would read as a line comment running past the `*/` into the code that follows it.
function collect(
	api: TypeScriptApi,
	node: ts.Node,
	source: ts.SourceFile,
	into: Array<Range>,
): void {
	if (api.isJSDoc(node)) return

	into.push(...trivia_at(api, source.text, node.pos))

	for (const child of node.getChildren(source)) collect(api, child, source, into)
}

// Parsed as TypeScript whatever the extension, because a `.js` file is valid TypeScript syntax and JSX
// is not — JSX text holding `//` is exactly what a trivia read would mistake for a comment, and here
// it is a parse error instead.
function script_ranges(api: TypeScriptApi, text: string): Array<Range> | undefined {
	const source = api.createSourceFile(VIRTUAL_FILE_NAME, text, api.ScriptTarget.Latest, false)
	const diagnostics = (source as ts.SourceFile & { parseDiagnostics?: ReadonlyArray<unknown> })
		.parseDiagnostics

	if (diagnostics === undefined || diagnostics.length > 0) return undefined
	const ranges: Array<Range> = []

	collect(api, source, source, ranges)

	return ranges.filter((range) => is_comment(text, range))
}

function shifted(ranges: ReadonlyArray<Range>, offset: number): Array<Range> {
	return ranges.map((range): Range => [range[0] + offset, range[1] + offset])
}

function is_inside(blocks: ReadonlyArray<Range>, index: number): boolean {
	return blocks.some((block) => index >= block[0] && index < block[1])
}

function markup_ranges(text: string, blocks: ReadonlyArray<Range>): Array<Range> {
	return [...text.matchAll(MARKUP_COMMENT)]
		.filter((match) => !is_inside(blocks, match.index))
		.map((match): Range => [match.index, match.index + match[0].length])
}

function block_ranges(api: TypeScriptApi, match: RegExpExecArray): Array<Range> | undefined {
	if (match.groups?.['tag'] !== SCRIPT_TAG) return []
	const body = match.groups['body'] ?? ''
	const ranges = script_ranges(api, body)

	return ranges && shifted(ranges, match.index + match[0].indexOf(body))
}

function svelte_ranges(api: TypeScriptApi, text: string): Array<Range> | undefined {
	const matches = [...text.matchAll(RAW_BLOCK)]
	const scripts = matches.map((match) => block_ranges(api, match))

	if (scripts.includes(undefined)) return undefined
	const blocks = matches.map((match): Range => [match.index, match.index + match[0].length])

	return [...scripts.flatMap((ranges) => ranges ?? []), ...markup_ranges(text, blocks)]
}

// A comment spanning lines is a line terminator to the program — `return` followed by one returns
// nothing — so its break is kept, and a one-line comment in its place cannot strip to the same text.
function mark_for(text: string, start: number, end: number): string {
	return text.slice(start, end).includes(LINE_BREAK) ? `${MARK}${LINE_BREAK}${MARK}` : MARK
}

function marked(text: string, ranges: ReadonlyArray<Range>): string {
	const ordered = ranges.toSorted((left, right) => left[0] - right[0])
	let result = ''
	let cursor = 0

	for (const [start, end] of ordered) {
		if (start < cursor) continue
		result += `${text.slice(cursor, start)}${mark_for(text, start, end)}`
		cursor = end
	}

	return `${result}${text.slice(cursor)}`
}

// A comment is whitespace to the program, so it becomes one space, and a line it alone occupied goes
// away. Indentation and lines without a comment are kept byte for byte — a blank line in a template
// literal is data.
function normalized_line(line: string): Array<string> {
	if (!line.includes(MARK)) return [line]
	const indentation = line.slice(0, line.length - line.trimStart().length)
	const words = line
		.split(MARK)
		.map((part) => part.trim())
		.filter((part) => part !== '')

	return words.length === 0 ? [] : [`${indentation}${words.join(SEPARATOR)}`]
}

function without(text: string, ranges: ReadonlyArray<Range>): string {
	return marked(text, ranges)
		.split(LINE_BREAK)
		.flatMap((line) => normalized_line(line))
		.join(LINE_BREAK)
}

function strip(api: TypeScriptApi, text: string, is_svelte: boolean): string | undefined {
	const ranges = is_svelte ? svelte_ranges(api, text) : script_ranges(api, text)

	return (
		ranges &&
		without(
			text,
			ranges.filter((range) => !is_directive(text, range)),
		)
	)
}

const comment_ranges = { strip }

export { comment_ranges }
export type { TypeScriptApi }
