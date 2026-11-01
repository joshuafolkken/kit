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
// the name was alone in takes the new specifier instead. A type-only name stays type-only. Nothing
// but import declarations is read, so strings, keys and other uses of the name are never touched.

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

	return found[0]
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

function insert_edit(moving: Moving, keyword: string, to: string): Replacement {
	const { declaration, element } = moving
	const is_type = keyword !== '' || element.isTypeOnly
	const text = `\nimport ${is_type ? 'type ' : ''}{ ${bare_text(element)} } from ${quoted(declaration, to)}`

	return { start: declaration.getEnd(), end: declaration.getEnd(), text }
}

function specifier_edit(declaration: ts.ImportDeclaration, to: string): Replacement {
	const { moduleSpecifier: module_specifier } = declaration

	return {
		start: module_specifier.getStart(),
		end: module_specifier.getEnd(),
		text: quoted(declaration, to),
	}
}

// The clause rebuilt without the moving name; `undefined` when no name would be left in it.
function clause_edit(
	clause: ts.ImportClause,
	keyword: string,
	remaining: ReadonlyArray<string>,
): Replacement | undefined {
	const named_text = remaining.length > 0 ? `{ ${remaining.join(', ')} }` : undefined
	const parts = [clause.name?.text, named_text].filter((part) => part !== undefined)
	if (parts.length === 0) return undefined

	return { start: clause.getStart(), end: clause.getEnd(), text: keyword + parts.join(', ') }
}

function edits_of(
	api: TypeScriptApi,
	moving: Moving,
	clause: ts.ImportClause,
	to: string,
): ReadonlyArray<Replacement> {
	const { declaration } = moving
	const remaining = elements_of(api, declaration)
		.filter((element) => element !== moving.element)
		.map((element) => element.getText())
	const keyword = type_keyword(api, clause)
	const kept = clause_edit(clause, keyword, remaining)

	if (kept === undefined) return [specifier_edit(declaration, to)]

	return [kept, insert_edit(moving, keyword, to)]
}

// `is_taken`: the destination already imports the name, so moving it would bind it twice.
function rewrite(
	api: TypeScriptApi,
	file_name: string,
	text: string,
	request: MoveRequest,
): RenameResult {
	const source = api.createSourceFile(file_name, text, api.ScriptTarget.Latest, true)
	const is_taken = imports_from(api, source, request.to).some(
		(declaration) => named(api, declaration, request.name).length > 0,
	)
	const moving = moving_of(api, source, request)
	const clause = moving?.declaration.importClause
	if (moving === undefined || clause === undefined || is_taken) return { text, count: 0, is_taken }
	const edits = edits_of(api, moving, clause, request.to)

	return { text: rename_identifier.apply(text, edits), count: 1, is_taken }
}

const import_move = { rewrite }

export type { MoveRequest }
export { import_move }
