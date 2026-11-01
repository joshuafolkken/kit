import type ts from 'typescript'
import {
	rename_identifier,
	type RenameResult,
	type Replacement,
	type TypeScriptApi,
} from './rename-identifier'

// The rewrite behind `josh rename <name> <name> --import <from> <to>` (joshuafolkken/kit#5792): one
// named import moved to another module under the same name.
//
// **Only the named import moves, never the declaration's other names.** `import { a, b } from 'x'`
// moving `b` keeps `import { a } from 'x'` and adds `import { b } from 'y'` below it; a declaration
// the name was alone in takes the new specifier instead. A file already importing names from the new
// module gets the name in that declaration instead, and a declaration it leaves empty goes
// (joshuafolkken/kit#5800); `import type { … }` takes only a type-only name. A type-only name stays
// type-only. Only the name and its comma are cut, so a comment in the braces stays. Nothing but import declarations is
// read, so strings, keys and other uses of the name are never touched. A name imported twice from the
// old module is not guessed at: the file counts as untouched.

const BLANK = /[\t ]/u

interface MoveRequest {
	name: string
	from: string
	to: string
}

interface Moving {
	declaration: ts.ImportDeclaration
	element: ts.ImportSpecifier
}

function specifier_of(api: TypeScriptApi, declaration: ts.ImportDeclaration): string | undefined {
	const { moduleSpecifier: module_specifier } = declaration

	return api.isStringLiteral(module_specifier) ? module_specifier.text : undefined
}

function imports_from(
	api: TypeScriptApi,
	source: ts.SourceFile,
	specifier: string,
): ReadonlyArray<ts.ImportDeclaration> {
	return source.statements
		.filter((statement) => api.isImportDeclaration(statement))
		.filter((declaration) => specifier_of(api, declaration) === specifier)
}

function elements_of(
	api: TypeScriptApi,
	declaration: ts.ImportDeclaration,
): ReadonlyArray<ts.ImportSpecifier> {
	const bindings = declaration.importClause?.namedBindings

	if (bindings === undefined || !api.isNamedImports(bindings)) return []

	return bindings.elements
}

function named(
	api: TypeScriptApi,
	declaration: ts.ImportDeclaration,
	name: string,
): ReadonlyArray<ts.ImportSpecifier> {
	return elements_of(api, declaration).filter(
		(element) => (element.propertyName ?? element.name).text === name,
	)
}

function moving_of(
	api: TypeScriptApi,
	source: ts.SourceFile,
	request: MoveRequest,
): Moving | undefined {
	const found = imports_from(api, source, request.from).flatMap((declaration) =>
		named(api, declaration, request.name).map((element) => ({ declaration, element })),
	)

	return found.length === 1 ? found[0] : undefined
}

function quoted(declaration: ts.ImportDeclaration, specifier: string): string {
	const quote = declaration.getSourceFile().text.charAt(declaration.moduleSpecifier.getStart())

	return `${quote}${specifier}${quote}`
}

// The element without its `type` keyword, which moves to the new declaration's own `import type`.
function bare_text(element: ts.ImportSpecifier): string {
	const { propertyName: property_name, name } = element

	return property_name === undefined ? name.text : `${property_name.getText()} as ${name.text}`
}

// `import type { … }`'s `type`, which covers every name in the clause.
function type_keyword(api: TypeScriptApi, clause: ts.ImportClause): string {
	return clause.phaseModifier === api.SyntaxKind.TypeKeyword ? 'type ' : ''
}

function is_type_only(keyword: string, element: ts.ImportSpecifier): boolean {
	return keyword !== '' || element.isTypeOnly
}

function insert_edit(moving: Moving, keyword: string, to: string): Replacement {
	const { declaration, element } = moving
	const is_type = is_type_only(keyword, element)
	const text = `\nimport ${is_type ? 'type ' : ''}{ ${bare_text(element)} } from ${quoted(declaration, to)}`

	return { start: declaration.getEnd(), end: declaration.getEnd(), text }
}

// A declaration from the new module with named imports the name can join: `import type { … }` takes
// a type-only name alone.
function accepts(api: TypeScriptApi, declaration: ts.ImportDeclaration, is_type: boolean): boolean {
	const clause = declaration.importClause

	if (clause === undefined || elements_of(api, declaration).length === 0) return false

	return is_type || type_keyword(api, clause) === ''
}

// The moved name after the joined declaration's last one; a type-only name joining a value
// declaration keeps an inline `type`.
function joined_text(
	api: TypeScriptApi,
	last: ts.ImportSpecifier,
	element: ts.ImportSpecifier,
	is_type: boolean,
): string {
	const inline = is_type && type_keyword(api, last.parent.parent) === '' ? 'type ' : ''

	return `, ${inline}${bare_text(element)}`
}

// The moved name appended to the new module's existing declaration (joshuafolkken/kit#5800), so the
// file never imports the same module twice.
function merge_edit(
	api: TypeScriptApi,
	moving: Moving,
	keyword: string,
	to: string,
): Replacement | undefined {
	const { declaration, element } = moving
	const is_type = is_type_only(keyword, element)
	const into = imports_from(api, declaration.getSourceFile(), to).find(
		(candidate) => candidate !== declaration && accepts(api, candidate, is_type),
	)
	const last = into === undefined ? undefined : elements_of(api, into).at(-1)
	if (last === undefined) return undefined

	return {
		start: last.getEnd(),
		end: last.getEnd(),
		text: joined_text(api, last, element, is_type),
	}
}

// The whole declaration with its line break, for a name that was alone in it and joined another.
function drop_edit(declaration: ts.ImportDeclaration): Replacement {
	const { text } = declaration.getSourceFile()
	const end = declaration.getEnd()
	const line_end = text.charAt(end) === '\n' ? end + 1 : end

	return { start: declaration.getStart(), end: line_end, text: '' }
}

function specifier_edit(declaration: ts.ImportDeclaration, to: string): Replacement {
	const { moduleSpecifier: module_specifier } = declaration

	return {
		start: module_specifier.getStart(),
		end: module_specifier.getEnd(),
		text: quoted(declaration, to),
	}
}

function blank_end(text: string, at: number): number {
	let end = at

	while (BLANK.test(text.charAt(end))) end += 1

	return end
}

function blank_start(text: string, at: number): number {
	let start = at

	while (BLANK.test(text.charAt(start - 1))) start -= 1

	return start
}

// The first token after `node`, skipping comments, so a comma inside a comment is never taken for it.
function comma_after(api: TypeScriptApi, node: ts.Node): number {
	const { text } = node.getSourceFile()
	const scanner = api.createScanner(api.ScriptTarget.Latest, true)

	scanner.setText(text, node.getEnd())
	scanner.scan()

	return scanner.getTokenStart()
}

// The name and the comma that separates it — the one after it, else (the last name, with no trailing
// comma) the one before it. What sits between, a comment included, stays for the formatter.
function cut_edits(api: TypeScriptApi, element: ts.ImportSpecifier): ReadonlyArray<Replacement> {
	const { elements } = element.parent
	const { text } = element.getSourceFile()
	const at = elements.indexOf(element)
	const previous = elements[at - 1]

	if (previous === undefined || elements.hasTrailingComma || at < elements.length - 1) {
		const after = comma_after(api, element) + 1

		return [{ start: element.getStart(), end: blank_end(text, after), text: '' }]
	}

	const before = comma_after(api, previous)
	const start = blank_start(text, element.getStart())

	return [
		{ start: before, end: before + 1, text: '' },
		{ start, end: element.getEnd(), text: '' },
	]
}

// A declaration the name was alone in: it joins another and goes, else it takes the new specifier.
function alone_edits(
	declaration: ts.ImportDeclaration,
	merge: Replacement | undefined,
	to: string,
): ReadonlyArray<Replacement> {
	if (merge === undefined) return [specifier_edit(declaration, to)]

	return [drop_edit(declaration), merge]
}

function edits_of(
	api: TypeScriptApi,
	moving: Moving,
	clause: ts.ImportClause,
	to: string,
): ReadonlyArray<Replacement> {
	const { element } = moving
	const keyword = type_keyword(api, clause)
	const merge = merge_edit(api, moving, keyword, to)
	const add = merge ?? insert_edit(moving, keyword, to)

	if (element.parent.elements.length > 1) return [...cut_edits(api, element), add]
	if (clause.name === undefined) return alone_edits(moving.declaration, merge, to)

	return [{ start: clause.name.getEnd(), end: element.parent.getEnd(), text: '' }, add]
}

// Never `is_taken`: the name keeps its local binding, so the move binds nothing new.
function rewrite(
	api: TypeScriptApi,
	file_name: string,
	text: string,
	request: MoveRequest,
): RenameResult {
	const source = api.createSourceFile(file_name, text, api.ScriptTarget.Latest, true)
	const moving = moving_of(api, source, request)
	const clause = moving?.declaration.importClause
	if (moving === undefined || clause === undefined) return { text, count: 0, is_taken: false }
	const edits = edits_of(api, moving, clause, request.to)

	return { text: rename_identifier.apply(text, edits), count: 1, is_taken: false }
}

const import_move = { rewrite }

export type { MoveRequest }
export { import_move }
