import type ts from 'typescript'
import {
	test_symbol_bindings,
	type BindingFacts,
	type Resolve,
	type TypeScript,
} from './test-symbol-bindings'
import { test_symbol_mocks } from './test-symbol-mocks'

// One file read syntactically for the symbol-level test selection (`test-symbol-users.ts`): its
// top-level declarations with their line spans and the names each references, the members of its
// object literals, the runtime imports and exports binding names across files, and the modules its
// `vi.mock` calls replace whole. A load-time statement is one more declaration, named `<load>` and its
// first line.

const LOAD = '<load>'
const SEPARATOR = '::'
const { EVERY, DEFAULT_EXPORT } = test_symbol_bindings

interface Declaration {
	start: number
	end: number
	references: Set<string>
}

interface FileFacts extends BindingFacts {
	declarations: Map<string, Declaration>
	members: Map<string, Map<string, string>>
	mocks: Set<string>
}

interface Reader {
	typescript: TypeScript
	resolve: Resolve
	file: string
	source: ts.SourceFile
	facts: FileFacts
}

function key_of(file: string, name: string): string {
	return `${file}${SEPARATOR}${name}`
}

function file_of(key: string): string {
	return key.slice(0, key.lastIndexOf(SEPARATOR))
}

function name_of(key: string): string {
	return key.slice(key.lastIndexOf(SEPARATOR) + SEPARATOR.length)
}

function line_of(reader: Reader, position: number): number {
	return reader.source.getLineAndCharacterOfPosition(position).line + 1
}

// A property name is no reference, and `a.b` is recorded whole by its access.
function is_reference(typescript: TypeScript, node: ts.Identifier): boolean {
	const { parent } = node
	if (typescript.isPropertyAccessExpression(parent)) return false

	return !typescript.isPropertyAssignment(parent) || parent.name !== node
}

function name_reference(typescript: TypeScript, node: ts.Node): string | undefined {
	if (typescript.isPropertyAccessExpression(node) && typescript.isIdentifier(node.expression)) {
		return `${node.expression.text}.${node.name.text}`
	}

	return typescript.isIdentifier(node) && is_reference(typescript, node) ? node.text : undefined
}

function import_specifier(typescript: TypeScript, node: ts.Node): string | undefined {
	if (!typescript.isCallExpression(node)) return undefined
	const [specifier] = node.arguments
	if (node.expression.kind !== typescript.SyntaxKind.ImportKeyword) return undefined

	return specifier !== undefined && typescript.isStringLiteral(specifier)
		? specifier.text
		: undefined
}

// `import('./x')` of a project module uses every export of it.
function dynamic_reference(reader: Reader, node: ts.Node): string | undefined {
	const specifier = import_specifier(reader.typescript, node)
	const module = specifier === undefined ? undefined : reader.resolve(specifier, reader.file)
	if (module === undefined) return undefined

	reader.facts.modules.add(module)

	return key_of(module, EVERY)
}

function collect_references(reader: Reader, node: ts.Node, references: Set<string>): void {
	const reference = name_reference(reader.typescript, node) ?? dynamic_reference(reader, node)

	if (reference !== undefined) references.add(reference)
	reader.typescript.forEachChild(node, (child) => {
		collect_references(reader, child, references)
	})
}

function declare(reader: Reader, name: string, node: ts.Node): void {
	const references = new Set<string>()

	collect_references(reader, node, references)
	reader.facts.declarations.set(name, {
		start: line_of(reader, node.getStart(reader.source)),
		end: line_of(reader, node.getEnd()),
		references,
	})
}

function named_declaration(
	typescript: TypeScript,
	statement: ts.Statement,
): ts.Identifier | undefined {
	if (typescript.isFunctionDeclaration(statement) || typescript.isClassDeclaration(statement)) {
		return statement.name
	}

	return typescript.isEnumDeclaration(statement) ? statement.name : undefined
}

function declared_names(typescript: TypeScript, statement: ts.Statement): Array<string> {
	if (typescript.isVariableStatement(statement)) {
		return statement.declarationList.declarations.flatMap((item) =>
			typescript.isIdentifier(item.name) ? [item.name.text] : [],
		)
	}

	const name = named_declaration(typescript, statement)

	return name === undefined ? [] : [name.text]
}

function property_name(typescript: TypeScript, name: ts.PropertyName): string | undefined {
	return typescript.isIdentifier(name) || typescript.isStringLiteral(name) ? name.text : undefined
}

// `{ a, b: c, d: 'x' }`: the member `a` is the local `a`, `b` the local `c`, and `d` — any other value —
// a declaration of its own, `<object>.d`, so a table read item by item (`EVENT_KIND.x`) reaches only
// the readers of the item that changed (joshuafolkken/kit#7979).
function member_of(
	reader: Reader,
	object: string,
	property: ts.ObjectLiteralElementLike,
): Array<[string, string]> {
	const { typescript } = reader

	if (typescript.isShorthandPropertyAssignment(property)) {
		return [[property.name.text, property.name.text]]
	}

	if (!typescript.isPropertyAssignment(property)) return []
	const name = property_name(typescript, property.name)
	if (name === undefined) return []
	if (typescript.isIdentifier(property.initializer)) return [[name, property.initializer.text]]
	declare(reader, `${object}.${name}`, property)

	return [[name, `${object}.${name}`]]
}

function object_of(
	typescript: TypeScript,
	item: ts.VariableDeclaration,
): ts.ObjectLiteralExpression | undefined {
	const { initializer } = item

	return initializer !== undefined && typescript.isObjectLiteralExpression(initializer)
		? initializer
		: undefined
}

function read_members(reader: Reader, statement: ts.VariableStatement): void {
	const { typescript } = reader

	for (const item of statement.declarationList.declarations) {
		const object = object_of(typescript, item)
		if (object === undefined || !typescript.isIdentifier(item.name)) continue
		const { text } = item.name
		const members = object.properties.flatMap((property) => member_of(reader, text, property))

		reader.facts.members.set(text, new Map(members))
	}
}

function has_modifier(typescript: TypeScript, node: ts.Node, kind: ts.SyntaxKind): boolean {
	const modifiers = typescript.canHaveModifiers(node) ? typescript.getModifiers(node) : undefined

	return modifiers?.some((modifier) => modifier.kind === kind) ?? false
}

// The name a declaration is exported as — `export default function f` exports `f` as `default` — or
// none for a declaration not exported.
function export_name(
	typescript: TypeScript,
	statement: ts.Statement,
	name: string,
): string | undefined {
	const kinds = typescript.SyntaxKind
	if (!has_modifier(typescript, statement, kinds.ExportKeyword)) return undefined

	return has_modifier(typescript, statement, kinds.DefaultKeyword) ? DEFAULT_EXPORT : name
}

function read_declaration(reader: Reader, statement: ts.Statement, names: Array<string>): void {
	for (const name of names) {
		const exported = export_name(reader.typescript, statement, name)

		declare(reader, name, statement)
		if (exported !== undefined) reader.facts.exports.set(exported, name)
	}

	if (reader.typescript.isVariableStatement(statement)) read_members(reader, statement)
}

function is_type_only(typescript: TypeScript, statement: ts.Statement): boolean {
	return (
		typescript.isInterfaceDeclaration(statement) || typescript.isTypeAliasDeclaration(statement)
	)
}

// `vi.mock('./x')` replacing `x` whole keeps the test from running on a change to `x`; one keeping
// the original (`importOriginal`) uses every export of `x` (joshuafolkken/kit#7980).
function read_mock(reader: Reader, statement: ts.Statement, name: string): void {
	const mock = test_symbol_mocks.mock_of(reader.typescript, statement)
	if (mock === undefined) return
	const module = reader.resolve(mock.specifier, reader.file)

	if (module === undefined) return
	if (mock.is_partial) reader.facts.declarations.get(name)?.references.add(key_of(module, EVERY))
	else reader.facts.mocks.add(module)
}

// `export default <expression>` is the declaration `default`.
function read_load(reader: Reader, statement: ts.Statement): void {
	const line = line_of(reader, statement.getStart(reader.source))
	const is_default = reader.typescript.isExportAssignment(statement) && !statement.isExportEquals
	const name = is_default ? DEFAULT_EXPORT : `${LOAD}${String(line)}`

	declare(reader, name, statement)
	if (is_default) reader.facts.exports.set(DEFAULT_EXPORT, DEFAULT_EXPORT)
	read_mock(reader, statement, name)
}

function read_statement(reader: Reader, statement: ts.Statement): void {
	const { typescript } = reader
	const names = declared_names(typescript, statement)

	if (typescript.isImportDeclaration(statement) || typescript.isExportDeclaration(statement)) {
		test_symbol_bindings.read_binding(reader, statement)
	} else if (names.length > 0) read_declaration(reader, statement, names)
	else if (!is_type_only(typescript, statement)) read_load(reader, statement)
}

function empty_facts(): FileFacts {
	return {
		declarations: new Map(),
		members: new Map(),
		exports: new Map(),
		imports: new Map(),
		reexports: [],
		spans: [],
		modules: new Set(),
		mocks: new Set(),
	}
}

function read_file(
	typescript: TypeScript,
	resolve: Resolve,
	file: string,
	text: string,
): FileFacts {
	const source = typescript.createSourceFile(file, text, typescript.ScriptTarget.Latest, true)
	const reader: Reader = { typescript, resolve, file, source, facts: empty_facts() }

	for (const statement of source.statements) read_statement(reader, statement)

	return reader.facts
}

const test_symbol_facts = {
	DEFAULT_EXPORT,
	EVERY,
	LOAD,
	SEPARATOR,
	empty_facts,
	key_of,
	file_of,
	name_of,
	read_file,
}

export type { FileFacts }
export { test_symbol_facts }
