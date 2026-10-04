import path from 'node:path'
import ts from 'typescript'

// One member of an exported namespace object — `const git_prompt = { confirm_push }` exported as
// `export { git_prompt }` has the member `git_prompt.confirm_push`. The declaration node is the
// property inside the object literal, which is what the checker hands back as the declaration of the
// property symbol any `git_prompt.confirm_push` access resolves to.
interface NamespaceMember {
	namespace: string
	member: string
	file: string
	line: number
	declaration: ts.Node
}

interface Namespace {
	declaration: ts.VariableDeclaration
	literal: ts.ObjectLiteralExpression
	members: ReadonlyArray<NamespaceMember>
}

// The namespace convention names its object in `snake_case`; an `UPPER_CASE` constant is data, and
// an annotated one (`Record<string, CommandEntry>`) is a table read by key rather than a namespace.
const NAMESPACE_NAME = /^[a-z][\d_a-z]*$/u
// A library's public entry hands its namespaces to consumers kit cannot see, so none of their
// members is ever unused from here.
const PUBLIC_ENTRY = 'index.ts'

// `as const`, `satisfies` and parentheses wrap the literal without changing what it declares.
function unwrap_literal(expression: ts.Expression): ts.Expression {
	let current = expression

	while (
		ts.isAsExpression(current) ||
		ts.isSatisfiesExpression(current) ||
		ts.isParenthesizedExpression(current)
	) {
		current = current.expression
	}

	return current
}

function namespace_literal(
	declaration: ts.VariableDeclaration,
): ts.ObjectLiteralExpression | undefined {
	if (declaration.initializer === undefined || declaration.type !== undefined) return undefined
	const literal = unwrap_literal(declaration.initializer)

	return ts.isObjectLiteralExpression(literal) ? literal : undefined
}

function local_export(statement: ts.Statement): ts.ExportDeclaration | undefined {
	if (!ts.isExportDeclaration(statement)) return undefined

	return statement.moduleSpecifier === undefined && !statement.isTypeOnly ? statement : undefined
}

function export_specifiers(statement: ts.Statement): ReadonlyArray<ts.ExportSpecifier> {
	const clause = local_export(statement)?.exportClause

	return clause !== undefined && ts.isNamedExports(clause) ? clause.elements : []
}

// The names a file exports through a bare `export { a, b }` — the namespace convention's export form.
// A re-export (`export { x } from`) declares nothing here, and a type-only export is no value.
function exported_local_names(source: ts.SourceFile): ReadonlySet<string> {
	const specifiers = source.statements.flatMap((statement) => export_specifiers(statement))

	return new Set(specifiers.map((specifier) => (specifier.propertyName ?? specifier.name).text))
}

// A spread or a computed key names no member a reference could resolve to by name.
function member_name(element: ts.ObjectLiteralElementLike): string | undefined {
	if (ts.isSpreadAssignment(element) || ts.isComputedPropertyName(element.name)) return undefined

	return element.name.text
}

function to_member(
	namespace: string,
	element: ts.ObjectLiteralElementLike,
	source: ts.SourceFile,
): Array<NamespaceMember> {
	const member = member_name(element)
	if (member === undefined) return []
	const { line } = source.getLineAndCharacterOfPosition(element.getStart(source))

	return [{ namespace, member, file: source.fileName, line: line + 1, declaration: element }]
}

function to_namespace(
	declaration: ts.VariableDeclaration,
	exported: ReadonlySet<string>,
	source: ts.SourceFile,
): Array<Namespace> {
	const literal = namespace_literal(declaration)
	if (literal === undefined || !ts.isIdentifier(declaration.name)) return []
	const { text } = declaration.name
	if (!exported.has(text) || !NAMESPACE_NAME.test(text)) return []
	const members = literal.properties.flatMap((element) => to_member(text, element, source))

	return [{ declaration, literal, members }]
}

function is_scanned_source(source: ts.SourceFile): boolean {
	return source.fileName.endsWith('.ts') && path.basename(source.fileName) !== PUBLIC_ENTRY
}

function collect_namespaces(source: ts.SourceFile): Array<Namespace> {
	if (!is_scanned_source(source)) return []
	const exported = exported_local_names(source)

	return source.statements
		.filter((statement) => ts.isVariableStatement(statement))
		.flatMap((statement) => [...statement.declarationList.declarations])
		.flatMap((declaration) => to_namespace(declaration, exported, source))
}

const namespace_members = { collect_namespaces }

export type { Namespace, NamespaceMember }
export { namespace_members }
