import type { TypeScriptApi } from '#scripts/review/comment-ranges'
import type ts from 'typescript'
import type { Hunk } from './test-pinned-logic'

// The added-file half of `josh test:pinned` (joshuafolkken/kit#4647). Reverting an added file is a
// missing module every importer fails on, so its functions are probed instead: each top-level function
// — a `function` declaration, a `const` bound to a function, or a function member of a top-level object
// literal (a namespace object) — becomes one hunk whose lines carry that function with its body
// replaced by a throw. `test_pinned_logic.revert` puts those lines in, so a probe runs as a hunk does.
//
// Only a script file is parsed: a Svelte component's markup is not TypeScript, and its script block
// holds no module-level function an importer calls by name.

const STUB_BODY = "{ throw new Error('josh test:pinned') }"
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/u
const LINE_BREAK = '\n'
const DEFAULT_NAME = 'default'

type FunctionValue = ts.ArrowFunction | ts.FunctionExpression

interface FunctionSite {
	name: string
	extent: ts.Node
	body: ts.Node
}

function is_script(file: string): boolean {
	return SCRIPT_FILE.test(file)
}

function is_function_value(api: TypeScriptApi, node: ts.Node | undefined): node is FunctionValue {
	if (node === undefined) return false

	return api.isArrowFunction(node) || api.isFunctionExpression(node)
}

function member_site(
	api: TypeScriptApi,
	owner: string,
	member: ts.ObjectLiteralElementLike,
): Array<FunctionSite> {
	if (api.isMethodDeclaration(member) && member.body !== undefined) {
		return [{ name: `${owner}.${member.name.getText()}`, extent: member, body: member.body }]
	}

	if (!api.isPropertyAssignment(member) || !is_function_value(api, member.initializer)) return []

	return [
		{ name: `${owner}.${member.name.getText()}`, extent: member, body: member.initializer.body },
	]
}

function declaration_sites(
	api: TypeScriptApi,
	declaration: ts.VariableDeclaration,
): Array<FunctionSite> {
	const { initializer } = declaration
	const name = declaration.name.getText()

	if (is_function_value(api, initializer)) {
		return [{ name, extent: declaration, body: initializer.body }]
	}

	if (initializer === undefined || !api.isObjectLiteralExpression(initializer)) return []

	return initializer.properties.flatMap((member) => member_site(api, name, member))
}

// An overload signature has no body to replace.
function function_site(statement: ts.FunctionDeclaration): Array<FunctionSite> {
	if (statement.body === undefined) return []

	return [{ name: statement.name?.text ?? DEFAULT_NAME, extent: statement, body: statement.body }]
}

function statement_sites(api: TypeScriptApi, statement: ts.Statement): Array<FunctionSite> {
	if (api.isFunctionDeclaration(statement)) return function_site(statement)
	if (!api.isVariableStatement(statement)) return []

	return statement.declarationList.declarations.flatMap((declaration) =>
		declaration_sites(api, declaration),
	)
}

// The whole lines the function spans, with its body swapped for the throw: the hunk replaces lines,
// so a signature sharing a line with other code keeps that code.
function stub_hunk(file: string, source: ts.SourceFile, site: FunctionSite): Hunk {
	const start = site.extent.getStart(source)
	const first = source.getLineAndCharacterOfPosition(start).line
	const last = source.getLineAndCharacterOfPosition(site.extent.getEnd()).line
	const offset = start - source.getLineAndCharacterOfPosition(start).character
	const lines = source.text.slice(offset, source.getLineEndOfPosition(site.extent.getEnd()))
	const before = lines.slice(0, site.body.getStart(source) - offset)
	const stubbed = `${before}${STUB_BODY}${lines.slice(site.body.getEnd() - offset)}`

	return {
		file,
		new_start: first + 1,
		new_count: last - first + 1,
		old_lines: stubbed.split(LINE_BREAK),
		new_lines: lines.split(LINE_BREAK),
		function_name: site.name,
	}
}

function stub_hunks(api: TypeScriptApi, file: string, content: string): Array<Hunk> {
	const source = api.createSourceFile(file, content, api.ScriptTarget.Latest, true)

	return source.statements
		.flatMap((statement) => statement_sites(api, statement))
		.map((site) => stub_hunk(file, source, site))
}

const test_pinned_functions = { STUB_BODY, is_script, stub_hunks }

export { test_pinned_functions }
