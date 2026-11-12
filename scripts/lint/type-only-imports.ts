import { file_reader } from '#scripts/lib/read-file'
import type ts from 'typescript'

// The module specifiers a file names only for their types: an `import type` or an
// `export type … from` declaration, which the transpiler drops whole, so the test runner's module graph
// never holds the edge (joshuafolkken/kit#5368). An `import { type A }` is left out: under
// `verbatimModuleSyntax` it stays as a side-effect import. A declaration is matched to the reference
// `preProcessFile` reports by where its specifier sits, never by its text, so a value import of the
// same module keeps its edge whichever declarations `preProcessFile` lists.
type TypeScript = typeof ts
type ModuleDeclaration = ts.ImportDeclaration | ts.ExportDeclaration

function declaration_of(
	typescript: TypeScript,
	statement: ts.Statement,
): ModuleDeclaration | undefined {
	if (typescript.isImportDeclaration(statement)) return statement
	if (typescript.isExportDeclaration(statement)) return statement

	return undefined
}

function is_type_only(typescript: TypeScript, declaration: ModuleDeclaration): boolean {
	if (typescript.isExportDeclaration(declaration)) return declaration.isTypeOnly

	return declaration.importClause?.phaseModifier === typescript.SyntaxKind.TypeKeyword
}

// Where the specifier's literal starts, its opening quote — the `pos` `preProcessFile` reports.
function type_only_position(
	typescript: TypeScript,
	source: ts.SourceFile,
	statement: ts.Statement,
): number | undefined {
	const declaration = declaration_of(typescript, statement)
	if (declaration === undefined || !is_type_only(typescript, declaration)) return undefined
	const specifier = declaration.moduleSpecifier
	if (specifier === undefined || !typescript.isStringLiteral(specifier)) return undefined

	return specifier.getStart(source)
}

// The specifiers `preProcessFile` finds less the type-only declarations': the edges the test runner
// follows.
function runtime_specifiers(typescript: TypeScript, file: string, content: string): Array<string> {
	const source = typescript.createSourceFile(file, content, typescript.ScriptTarget.Latest)
	const type_only = new Set(
		source.statements.map((statement) => type_only_position(typescript, source, statement)),
	)

	return typescript
		.preProcessFile(content, true, true)
		.importedFiles.filter((reference) => !type_only.has(reference.pos))
		.map((reference) => reference.fileName)
}

function strings(typescript: TypeScript, file: string): Array<string> {
	const content = file_reader.read_if_readable(file) ?? ''
	const source = typescript.createSourceFile(file, content, typescript.ScriptTarget.Latest)
	const found: Array<string> = []

	function visit(node: ts.Node): void {
		if (typescript.isStringLiteralLike(node) || typescript.isTemplateLiteralToken(node)) {
			found.push(node.text)
		}

		typescript.forEachChild(node, visit)
	}

	visit(source)

	return found
}

const type_only_imports = { runtime_specifiers, strings }

export { type_only_imports }
