import type ts from 'typescript'

// Only closed module inputs can reuse an individual green test. Anything outside this small
// vocabulary (filesystem, environment, subprocesses, dynamic loading, globals) remains unknown.
const GLOBALS: ReadonlySet<string> = new Set([
	'undefined',
	'NaN',
	'Infinity',
	'Array',
	'Object',
	'String',
	'Number',
	'Boolean',
	'BigInt',
	'Symbol',
	'Map',
	'Set',
	'WeakMap',
	'WeakSet',
	'JSON',
	'RegExp',
	'Error',
	'TypeError',
	'RangeError',
	'Promise',
	'parseInt',
	'parseFloat',
	'isNaN',
	'isFinite',
])
const UNSAFE: ReadonlySet<string> = new Set([
	'process',
	'global',
	'globalThis',
	'eval',
	'Function',
	'require',
	'constructor',
	'__proto__',
	'prototype',
	'vi',
	'vitest',
	'inject',
	'provide',
])

type TypeScript = typeof ts

function is_property(typescript: TypeScript, node: ts.Identifier): boolean {
	const { parent } = node

	return (
		(typescript.isPropertyAccessExpression(parent) && parent.name === node) ||
		((typescript.isPropertyAssignment(parent) || typescript.isMethodDeclaration(parent)) &&
			parent.name === node)
	)
}

function is_unsafe_syntax(typescript: TypeScript, node: ts.Node): boolean {
	return [
		typescript.isNamespaceImport(node),
		typescript.isElementAccessExpression(node),
		node.kind === typescript.SyntaxKind.ThisKeyword,
		typescript.isMetaProperty(node),
	].includes(true)
}

function is_dynamic_import(typescript: TypeScript, node: ts.Node): boolean {
	return (
		typescript.isCallExpression(node) &&
		node.expression.kind === typescript.SyntaxKind.ImportKeyword
	)
}

function is_unknown_identifier(
	typescript: TypeScript,
	node: ts.Identifier,
	checker: ts.TypeChecker,
): boolean {
	if (UNSAFE.has(node.text)) return true

	return (
		!is_property(typescript, node) &&
		checker.getSymbolAtLocation(node) === undefined &&
		!GLOBALS.has(node.text)
	)
}

function is_unknown(typescript: TypeScript, node: ts.Node, checker: ts.TypeChecker): boolean {
	if (is_unsafe_syntax(typescript, node) || is_dynamic_import(typescript, node)) return true
	if (!typescript.isIdentifier(node)) return false

	return is_unknown_identifier(typescript, node, checker)
}

function is_closed(typescript: TypeScript, file: string, content: string): boolean {
	const source = typescript.createSourceFile(file, content, typescript.ScriptTarget.Latest, true)
	const host = typescript.createCompilerHost({})

	host.getSourceFile = (name) => (name === file ? source : undefined)
	const program = typescript.createProgram([file], { noLib: true, noResolve: true }, host)
	const checker = program.getTypeChecker()

	function unknown(node: ts.Node): boolean {
		if (typescript.isTypeNode(node)) return false

		return is_unknown(typescript, node, checker) || typescript.forEachChild(node, unknown) === true
	}

	return program.getSyntacticDiagnostics(source).length === 0 && !unknown(source)
}

const test_inputs = { is_closed }

export { test_inputs }
