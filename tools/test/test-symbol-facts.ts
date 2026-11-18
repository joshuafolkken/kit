import type ts from 'typescript'

// One file read syntactically for the symbol-level test selection (`test-symbol-users.ts`): its
// top-level declarations with their line spans and the names each references, the objects bundling
// its functions, and the runtime imports and exports binding names across files. A load-time
// statement is one more declaration, named `<load>` and its first line.

type TypeScript = typeof ts
type Resolve = (specifier: string, file: string) => string | undefined

const LOAD = '<load>'
const EVERY = '*'
const DEFAULT_EXPORT = 'default'
const SEPARATOR = '::'

interface Declaration {
	start: number
	end: number
	references: Set<string>
}

interface Binding {
	module: string
	name: string
}

interface Reexport extends Binding {
	as: string
}

interface FileFacts {
	declarations: Map<string, Declaration>
	members: Map<string, Map<string, string>>
	exports: Map<string, string>
	imports: Map<string, Binding>
	reexports: Array<Reexport>
	modules: Set<string>
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

function is_exported(typescript: TypeScript, node: ts.Node): boolean {
	const modifiers = typescript.canHaveModifiers(node) ? typescript.getModifiers(node) : undefined

	return (
		modifiers?.some((modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword) ?? false
	)
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

// `{ a, b: c }`: the member `a` is the local `a`, the member `b` the local `c`.
function member_of(
	typescript: TypeScript,
	property: ts.ObjectLiteralElementLike,
): Array<[string, string]> {
	if (typescript.isShorthandPropertyAssignment(property)) {
		return [[property.name.text, property.name.text]]
	}

	if (!typescript.isPropertyAssignment(property)) return []
	const { name, initializer } = property

	return typescript.isIdentifier(name) && typescript.isIdentifier(initializer)
		? [[name.text, initializer.text]]
		: []
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
		const members = object.properties.flatMap((property) => member_of(typescript, property))

		reader.facts.members.set(item.name.text, new Map(members))
	}
}

function read_declaration(reader: Reader, statement: ts.Statement, names: Array<string>): void {
	const should_export = is_exported(reader.typescript, statement)

	for (const name of names) {
		declare(reader, name, statement)
		if (should_export) reader.facts.exports.set(name, name)
	}

	if (reader.typescript.isVariableStatement(statement)) read_members(reader, statement)
}

function import_module(reader: Reader, statement: ts.ImportDeclaration): string | undefined {
	const { typescript } = reader
	if (statement.importClause?.phaseModifier === typescript.SyntaxKind.TypeKeyword) return undefined
	const specifier = statement.moduleSpecifier

	return reader.typescript.isStringLiteral(specifier)
		? reader.resolve(specifier.text, reader.file)
		: undefined
}

function import_elements(reader: Reader, bindings: ts.NamedImports, module: string): void {
	const elements = bindings.elements.filter((element) => !element.isTypeOnly)

	for (const element of elements) {
		const name = (element.propertyName ?? element.name).text

		reader.facts.imports.set(element.name.text, { module, name })
	}
}

function import_bindings(reader: Reader, clause: ts.ImportClause, module: string): void {
	const { typescript, facts } = reader
	const named_bindings = clause.namedBindings

	if (clause.name !== undefined) {
		facts.imports.set(clause.name.text, { module, name: DEFAULT_EXPORT })
	}

	if (named_bindings === undefined) return
	if (typescript.isNamespaceImport(named_bindings)) {
		facts.imports.set(named_bindings.name.text, { module, name: EVERY })
	} else import_elements(reader, named_bindings, module)
}

function read_import(reader: Reader, statement: ts.ImportDeclaration): void {
	const module = import_module(reader, statement)
	if (module === undefined) return
	const clause = statement.importClause

	reader.facts.modules.add(module)
	if (clause !== undefined) import_bindings(reader, clause, module)
}

function export_module(reader: Reader, statement: ts.ExportDeclaration): string | undefined {
	const specifier = statement.moduleSpecifier
	if (specifier === undefined || !reader.typescript.isStringLiteral(specifier)) return undefined
	const module = reader.resolve(specifier.text, reader.file)

	if (module !== undefined) reader.facts.modules.add(module)

	return module
}

function export_element(reader: Reader, element: ts.ExportSpecifier, module?: string): void {
	const name = (element.propertyName ?? element.name).text

	if (module === undefined) reader.facts.exports.set(element.name.text, name)
	else reader.facts.reexports.push({ module, name, as: element.name.text })
}

function export_elements(reader: Reader, clause: ts.NamedExportBindings, module?: string): void {
	if (!reader.typescript.isNamedExports(clause)) return
	const elements = clause.elements.filter((element) => !element.isTypeOnly)

	for (const element of elements) export_element(reader, element, module)
}

// `export * from './x'` re-exports every name of `x`.
function read_export(reader: Reader, statement: ts.ExportDeclaration): void {
	if (statement.isTypeOnly) return
	const module = export_module(reader, statement)
	const clause = statement.exportClause

	if (clause !== undefined) export_elements(reader, clause, module)
	else if (module !== undefined) reader.facts.reexports.push({ module, name: EVERY, as: EVERY })
}

function is_type_only(typescript: TypeScript, statement: ts.Statement): boolean {
	return (
		typescript.isInterfaceDeclaration(statement) || typescript.isTypeAliasDeclaration(statement)
	)
}

function read_load(reader: Reader, statement: ts.Statement): void {
	const line = line_of(reader, statement.getStart(reader.source))

	declare(reader, `${LOAD}${String(line)}`, statement)
}

function read_statement(reader: Reader, statement: ts.Statement): void {
	const { typescript } = reader
	const names = declared_names(typescript, statement)

	if (typescript.isImportDeclaration(statement)) read_import(reader, statement)
	else if (typescript.isExportDeclaration(statement)) read_export(reader, statement)
	else if (names.length > 0) read_declaration(reader, statement, names)
	else if (!is_type_only(typescript, statement)) read_load(reader, statement)
}

function read_file(
	typescript: TypeScript,
	resolve: Resolve,
	file: string,
	text: string,
): FileFacts {
	const source = typescript.createSourceFile(file, text, typescript.ScriptTarget.Latest, true)
	const facts: FileFacts = {
		declarations: new Map(),
		members: new Map(),
		exports: new Map(),
		imports: new Map(),
		reexports: [],
		modules: new Set(),
	}
	const reader: Reader = { typescript, resolve, file, source, facts }

	for (const statement of source.statements) read_statement(reader, statement)

	return facts
}

const test_symbol_facts = { EVERY, LOAD, SEPARATOR, key_of, file_of, name_of, read_file }

export type { Binding, FileFacts, Resolve, TypeScript }
export { test_symbol_facts }
