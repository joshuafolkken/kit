import type ts from 'typescript'

// The import and re-export statements of one file read for the symbol-level test selection
// (`test-symbol-facts.ts`, joshuafolkken/kit#7980): the names they bind across files, the modules
// they read, and each statement's span, so that a change to the statement itself — a swapped module,
// a renamed binding — selects the users of what it binds.

type TypeScript = typeof ts
type Resolve = (specifier: string, file: string) => string | undefined

const EVERY = '*'
const DEFAULT_EXPORT = 'default'

interface Binding {
	module: string
	name: string
}

interface Reexport extends Binding {
	as: string
}

// An import or re-export statement's lines, the local names it binds and the names it passes on.
interface BindingSpan {
	start: number
	end: number
	imports: Array<string>
	reexports: Array<Reexport>
}

interface BindingFacts {
	exports: Map<string, string>
	imports: Map<string, Binding>
	reexports: Array<Reexport>
	spans: Array<BindingSpan>
	modules: Set<string>
}

interface BindingReader {
	typescript: TypeScript
	resolve: Resolve
	file: string
	source: ts.SourceFile
	facts: BindingFacts
}

function line_of(reader: BindingReader, position: number): number {
	return reader.source.getLineAndCharacterOfPosition(position).line + 1
}

function import_module(reader: BindingReader, statement: ts.ImportDeclaration): string | undefined {
	const { typescript } = reader
	if (statement.importClause?.phaseModifier === typescript.SyntaxKind.TypeKeyword) return undefined
	const specifier = statement.moduleSpecifier

	return reader.typescript.isStringLiteral(specifier)
		? reader.resolve(specifier.text, reader.file)
		: undefined
}

function import_elements(reader: BindingReader, bindings: ts.NamedImports, module: string): void {
	const elements = bindings.elements.filter((element) => !element.isTypeOnly)

	for (const element of elements) {
		const name = (element.propertyName ?? element.name).text

		reader.facts.imports.set(element.name.text, { module, name })
	}
}

function import_bindings(reader: BindingReader, clause: ts.ImportClause, module: string): void {
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

function read_import(reader: BindingReader, statement: ts.ImportDeclaration): void {
	const module = import_module(reader, statement)
	if (module === undefined) return
	const clause = statement.importClause

	reader.facts.modules.add(module)
	if (clause !== undefined) import_bindings(reader, clause, module)
}

function export_module(reader: BindingReader, statement: ts.ExportDeclaration): string | undefined {
	const specifier = statement.moduleSpecifier
	if (specifier === undefined || !reader.typescript.isStringLiteral(specifier)) return undefined
	const module = reader.resolve(specifier.text, reader.file)

	if (module !== undefined) reader.facts.modules.add(module)

	return module
}

function export_element(reader: BindingReader, element: ts.ExportSpecifier, module?: string): void {
	const name = (element.propertyName ?? element.name).text

	if (module === undefined) reader.facts.exports.set(element.name.text, name)
	else reader.facts.reexports.push({ module, name, as: element.name.text })
}

function export_elements(
	reader: BindingReader,
	clause: ts.NamedExportBindings,
	module?: string,
): void {
	if (!reader.typescript.isNamedExports(clause)) return
	const elements = clause.elements.filter((element) => !element.isTypeOnly)

	for (const element of elements) export_element(reader, element, module)
}

// `export * from './x'` re-exports every name of `x`.
function read_export(reader: BindingReader, statement: ts.ExportDeclaration): void {
	if (statement.isTypeOnly) return
	const module = export_module(reader, statement)
	const clause = statement.exportClause

	if (clause !== undefined) export_elements(reader, clause, module)
	else if (module !== undefined) reader.facts.reexports.push({ module, name: EVERY, as: EVERY })
}

// An import or export statement, its span kept beside the names it binds.
function read_binding(
	reader: BindingReader,
	statement: ts.ImportDeclaration | ts.ExportDeclaration,
): void {
	const { facts, typescript } = reader
	const known = new Set(facts.imports.keys())
	const from = facts.reexports.length

	if (typescript.isImportDeclaration(statement)) read_import(reader, statement)
	else read_export(reader, statement)
	facts.spans.push({
		start: line_of(reader, statement.getStart(reader.source)),
		end: line_of(reader, statement.getEnd()),
		imports: [...facts.imports.keys()].filter((name) => !known.has(name)),
		reexports: facts.reexports.slice(from),
	})
}

const test_symbol_bindings = { DEFAULT_EXPORT, EVERY, read_binding }

export type { Binding, BindingFacts, BindingSpan, Reexport, Resolve, TypeScript }
export { test_symbol_bindings }
