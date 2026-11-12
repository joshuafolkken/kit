import type ts from 'typescript'

// The rewrite behind `josh rename` (joshuafolkken/kit#5236): one identifier and, optionally, one import
// specifier, renamed through the TypeScript parse tree rather than a pattern.
//
// **Only a binding is renamed, never a key.** `obj.old`, `{ old: 1 }` and `{ old: x } = obj` name a
// property of some other value, so they stay; a shorthand `{ old }` keeps its key and becomes
// `{ old: new }`. Strings and comments are not identifiers to the parser, so the walk never reaches
// them — a specifier is rewritten only where the module system reads it.

type TypeScriptApi = typeof ts

interface RenameRequest {
	old_name: string
	new_name: string
	specifier?: readonly [string, string] | undefined
}

interface Replacement {
	start: number
	end: number
	text: string
}

// `is_taken`: the new name is already a binding here, so the rename could shadow or merge with it —
// the rename matches by spelling, not by scope.
interface RenameResult {
	text: string
	count: number
	is_taken: boolean
}

// Calls whose first argument is a module specifier the test runner resolves like an import.
const MODULE_CALLS: ReadonlySet<string> = new Set([
	'vi.mock',
	'vi.doMock',
	'vi.importActual',
	'vi.importMock',
])
const NAME_KEY = 'name'

// The parents whose `name` is a property key rather than a binding.
function key_parent_kinds(api: TypeScriptApi): ReadonlySet<ts.SyntaxKind> {
	const kind = api.SyntaxKind

	return new Set([
		kind.PropertyAccessExpression,
		kind.PropertyAssignment,
		kind.PropertyDeclaration,
		kind.PropertySignature,
		kind.MethodDeclaration,
		kind.MethodSignature,
		kind.GetAccessor,
		kind.SetAccessor,
		kind.EnumMember,
		kind.JsxAttribute,
	])
}

function is_key_position(api: TypeScriptApi, node: ts.Identifier): boolean {
	const { parent } = node

	if (api.isQualifiedName(parent)) return parent.right === node
	if (api.isBindingElement(parent)) return parent.propertyName === node

	return key_parent_kinds(api).has(parent.kind) && Reflect.get(parent, NAME_KEY) === node
}

// A shorthand key is also the property's name, so the key is spelled out to keep it.
function keeps_key(api: TypeScriptApi, node: ts.Identifier): boolean {
	const { parent } = node

	if (api.isShorthandPropertyAssignment(parent)) return true

	return (
		api.isBindingElement(parent) &&
		parent.propertyName === undefined &&
		parent.dotDotDotToken === undefined &&
		api.isObjectBindingPattern(parent.parent)
	)
}

function identifier_replacement(
	api: TypeScriptApi,
	node: ts.Identifier,
	request: RenameRequest,
): Replacement | undefined {
	if (node.text !== request.old_name || is_key_position(api, node)) return undefined
	const text = keeps_key(api, node) ? `${node.text}: ${request.new_name}` : request.new_name

	return { start: node.getStart(), end: node.getEnd(), text }
}

function is_module_call(
	api: TypeScriptApi,
	call: ts.CallExpression,
	node: ts.StringLiteral,
): boolean {
	if (call.arguments.indexOf(node) !== 0) return false

	return (
		call.expression.kind === api.SyntaxKind.ImportKeyword ||
		MODULE_CALLS.has(call.expression.getText())
	)
}

function is_module_specifier(api: TypeScriptApi, node: ts.StringLiteral): boolean {
	const { parent } = node

	if (api.isImportDeclaration(parent) || api.isExportDeclaration(parent)) {
		return parent.moduleSpecifier === node
	}

	if (api.isCallExpression(parent)) return is_module_call(api, parent, node)

	return api.isLiteralTypeNode(parent) && api.isImportTypeNode(parent.parent)
}

function specifier_replacement(
	api: TypeScriptApi,
	node: ts.StringLiteral,
	specifier: RenameRequest['specifier'],
): Replacement | undefined {
	if (specifier?.[0] !== node.text || !is_module_specifier(api, node)) return undefined
	const start = node.getStart()
	const quote = node.getSourceFile().text.charAt(start)

	return { start, end: node.getEnd(), text: `${quote}${specifier[1]}${quote}` }
}

function replacement_at(
	api: TypeScriptApi,
	node: ts.Node,
	request: RenameRequest,
): Replacement | undefined {
	if (api.isIdentifier(node)) return identifier_replacement(api, node, request)
	if (api.isStringLiteral(node)) return specifier_replacement(api, node, request.specifier)

	return undefined
}

// `forEachChild` never descends into JSDoc, so a name inside a doc comment stays as written.
function collect(
	api: TypeScriptApi,
	node: ts.Node,
	request: RenameRequest,
	into: Array<Replacement>,
): void {
	const replacement = replacement_at(api, node, request)

	if (replacement !== undefined) into.push(replacement)
	api.forEachChild(node, (child) => {
		collect(api, child, request, into)
	})
}

// Applied from the end of the file backwards, so an earlier offset is never moved by a later edit.
function apply(text: string, replacements: ReadonlyArray<Replacement>): string {
	const backwards = replacements.toSorted((first, second) => second.start - first.start)
	let result = text

	for (const edit of backwards) {
		result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`
	}

	return result
}

function rewrite(
	api: TypeScriptApi,
	file_name: string,
	text: string,
	request: RenameRequest,
): RenameResult {
	const source = api.createSourceFile(file_name, text, api.ScriptTarget.Latest, true)
	const replacements: Array<Replacement> = []
	const existing: Array<Replacement> = []

	collect(api, source, request, replacements)
	collect(api, source, { old_name: request.new_name, new_name: request.new_name }, existing)

	return {
		text: apply(text, replacements),
		count: replacements.length,
		is_taken: existing.length > 0,
	}
}

const rename_identifier = { apply, rewrite }

export type { RenameRequest, RenameResult, Replacement, TypeScriptApi }
export { rename_identifier }
