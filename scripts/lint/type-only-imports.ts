import type ts from 'typescript'

// The module specifiers a file names only for their types: an `import type` or an
// `export type … from` declaration, which the transpiler drops whole, so the test runner's module graph
// never holds the edge (joshuafolkken/kit#5368). An `import { type A }` is left out: under
// `verbatimModuleSyntax` it stays as a side-effect import. One entry per declaration, so a specifier
// also imported for a value keeps that edge.
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

function type_only_specifier(typescript: TypeScript, statement: ts.Statement): string | undefined {
	const declaration = declaration_of(typescript, statement)
	if (declaration === undefined || !is_type_only(typescript, declaration)) return undefined
	const specifier = declaration.moduleSpecifier
	if (specifier === undefined || !typescript.isStringLiteral(specifier)) return undefined

	return specifier.text
}

function of(typescript: TypeScript, file: string, content: string): Array<string> {
	const source = typescript.createSourceFile(file, content, typescript.ScriptTarget.Latest)

	return source.statements
		.map((statement) => type_only_specifier(typescript, statement))
		.filter((specifier) => specifier !== undefined)
}

// The specifiers `preProcessFile` finds, each type-only declaration's taken out once: the edges the
// test runner follows.
function runtime_specifiers(typescript: TypeScript, file: string, content: string): Array<string> {
	const left = of(typescript, file, content)
	const found = typescript.preProcessFile(content, true, true).importedFiles

	return found
		.map((reference) => reference.fileName)
		.filter((specifier) => {
			const at = left.indexOf(specifier)

			if (at !== -1) left.splice(at, 1)

			return at === -1
		})
}

const type_only_imports = { of, runtime_specifiers }

export { type_only_imports }
