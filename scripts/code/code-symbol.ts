import type ts from 'typescript'

// The parse behind `josh code:symbol` (joshuafolkken/kit#7140): a declaration's extent comes from the
// TypeScript parse tree, so a read never guesses where a function ends.
//
// **The comment block touching a declaration is part of it.** A JSDoc or `//` block with no blank line
// before the declaration explains it, so it is printed with it; one a blank line separates belongs to
// whatever came before.

type TypeScriptApi = typeof ts

// `line` is where the declaration itself starts, `first_line` where its extent (comments included)
// does; `text` holds the extent's whole lines.
interface Declaration {
	name: string
	line: number
	first_line: number
	text: string
}

interface ParseContext {
	api: TypeScriptApi
	kinds: ReadonlySet<ts.SyntaxKind>
	source: ts.SourceFile
	lines: ReadonlyArray<string>
}

const BLANK_LINE = /\n[\t ]*\n/u
const LINE_BASE = 1
const NEWLINE = '\n'

function declaration_kinds(api: TypeScriptApi): ReadonlySet<ts.SyntaxKind> {
	const kind = api.SyntaxKind

	return new Set([
		kind.FunctionDeclaration,
		kind.ClassDeclaration,
		kind.InterfaceDeclaration,
		kind.TypeAliasDeclaration,
		kind.EnumDeclaration,
		kind.VariableDeclaration,
		kind.MethodDeclaration,
	])
}

function is_declaration(
	kinds: ReadonlySet<ts.SyntaxKind>,
	node: ts.Node,
): node is ts.NamedDeclaration {
	return kinds.has(node.kind)
}

// A variable is read as its whole statement, so `export const` comes with it.
function extent_node(api: TypeScriptApi, node: ts.Node): ts.Node {
	const statement = node.parent.parent

	return api.isVariableDeclaration(node) && api.isVariableStatement(statement) ? statement : node
}

function comment_start(context: ParseContext, node: ts.Node): number {
	const { text } = context.source
	const ranges = context.api.getLeadingCommentRanges(text, node.getFullStart()) ?? []
	let start = node.getStart(context.source)

	for (const range of ranges.toReversed()) {
		if (BLANK_LINE.test(text.slice(range.end, start))) break
		start = range.pos
	}

	return start
}

function line_of(context: ParseContext, position: number): number {
	return context.source.getLineAndCharacterOfPosition(position).line
}

function read_extent(context: ParseContext, name: string, node: ts.Node): Declaration {
	const extent = extent_node(context.api, node)
	const first = line_of(context, comment_start(context, extent))
	const last = line_of(context, extent.getEnd())
	const line = line_of(context, extent.getStart(context.source)) + LINE_BASE
	const text = context.lines.slice(first, last + LINE_BASE).join(NEWLINE)

	return { name, line, first_line: first + LINE_BASE, text }
}

function declared_name(context: ParseContext, node: ts.Node): string | undefined {
	if (!is_declaration(context.kinds, node)) return undefined
	const { name } = node

	return name !== undefined && context.api.isIdentifier(name) ? name.text : undefined
}

function collect(context: ParseContext, node: ts.Node, found: Array<Declaration>): void {
	const name = declared_name(context, node)

	if (name !== undefined) found.push(read_extent(context, name, node))
	context.api.forEachChild(node, (child) => {
		collect(context, child, found)
	})
}

// Every named declaration in the file, nested ones included, in source order.
function declarations(api: TypeScriptApi, file_name: string, text: string): Array<Declaration> {
	const source = api.createSourceFile(file_name, text, api.ScriptTarget.Latest, true)
	const context = { api, kinds: declaration_kinds(api), source, lines: text.split(NEWLINE) }
	const found: Array<Declaration> = []

	collect(context, source, found)

	return found
}

// The extent with its line numbers right-aligned, the way `Read` shows a file.
function numbered(declaration: Declaration): string {
	const lines = declaration.text.split(NEWLINE)
	const width = String(declaration.first_line + lines.length - LINE_BASE).length

	return lines
		.map((line, index) => `${String(declaration.first_line + index).padStart(width)}\t${line}`)
		.join(NEWLINE)
}

const code_symbol = { declarations, numbered }

export type { Declaration, TypeScriptApi }
export { code_symbol }
