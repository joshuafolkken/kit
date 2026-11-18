import type ts from 'typescript'

// **A top-level `vi.mock('<specifier>', …)` read for the symbol-level test selection**
// (joshuafolkken/kit#7980): a mock replacing the module whole keeps its test from running on a change to
// it, while one built on the original (`importOriginal` / `vi.importActual`) still runs that code.

type TypeScript = typeof ts

const MOCKER = 'vi'
const MOCK_CALL = 'mock'
const KEEPS_ORIGINAL = /\bimportOriginal\b|\bimportActual\b/u

interface Mock {
	specifier: string
	is_partial: boolean
}

function is_mock_call(typescript: TypeScript, call: ts.CallExpression): boolean {
	const callee = call.expression

	return (
		typescript.isPropertyAccessExpression(callee) &&
		typescript.isIdentifier(callee.expression) &&
		callee.expression.text === MOCKER &&
		callee.name.text === MOCK_CALL
	)
}

function call_of(typescript: TypeScript, statement: ts.Statement): ts.CallExpression | undefined {
	if (!typescript.isExpressionStatement(statement)) return undefined
	const { expression } = statement

	return typescript.isCallExpression(expression) && is_mock_call(typescript, expression)
		? expression
		: undefined
}

// The module a statement mocks and whether the mock keeps its original, or none for any other statement.
function mock_of(typescript: TypeScript, statement: ts.Statement): Mock | undefined {
	const call = call_of(typescript, statement)
	if (call === undefined) return undefined
	const [specifier, factory] = call.arguments
	if (specifier === undefined || !typescript.isStringLiteral(specifier)) return undefined
	const factory_text = factory === undefined ? '' : factory.getText()

	return { specifier: specifier.text, is_partial: KEEPS_ORIGINAL.test(factory_text) }
}

const test_symbol_mocks = { mock_of }

export type { Mock }
export { test_symbol_mocks }
