import { readFile } from 'node:fs/promises'
import type { TypeScriptApi } from '#scripts/review/comment-ranges'
import { review_code_tree } from '#scripts/review/review-code-tree'
import type ts from 'typescript'
import { test_pinned_functions } from './test-pinned-functions'
import type { Hunk } from './test-pinned-logic'

// The branch half of `josh test:pinned` (joshuafolkken/kit#7882). A changed hunk's revert can go red
// while one arm of a branch it adds is taken by no test, so each arm of a changed branch — an `if`'s
// then and explicit else, both arms of a `?:`, the right side of `??`, a `case` or `default` clause —
// becomes one probe hunk with that arm replaced by a throw. No related test going red means no test
// takes the arm. A branch counts as changed when its first line, or its arm's first line, is a changed
// line; an added file's every line is.
//
// Left out, each still covered by its hunk's revert: an `if` with no `else` (the false path has no node
// to throw in), the operands of `&&` and `||`, a non-script file (a Svelte component's markup is not
// TypeScript), and every file when `typescript` is not installed to parse it.

const THROW_EXPRESSION = `(() => ${test_pinned_functions.STUB_BODY})()`

interface Arm {
	name: string
	node: ts.Node
	replacement: string
}

// The 1-based changed lines of a file; `undefined` for an added file, all of whose lines changed.
type ChangedLines = ReadonlySet<number> | undefined

function statement_arm(name: string, node: ts.Node | undefined): Array<Arm> {
	if (node === undefined) return []

	return [{ name, node, replacement: test_pinned_functions.STUB_BODY }]
}

function expression_arm(name: string, node: ts.Node): Arm {
	return { name, node, replacement: THROW_EXPRESSION }
}

// An `else if` is not an arm of its own: its branches are read as their own `if`.
function if_arms(api: TypeScriptApi, node: ts.IfStatement): Array<Arm> {
	const otherwise = node.elseStatement
	const else_arm = otherwise === undefined || api.isIfStatement(otherwise) ? undefined : otherwise

	return [
		...statement_arm('if branch', node.thenStatement),
		...statement_arm('else branch', else_arm),
	]
}

function clause_arms(api: TypeScriptApi, node: ts.CaseOrDefaultClause): Array<Arm> {
	const name = api.isCaseClause(node) ? 'case branch' : 'default branch'

	return statement_arm(name, node.statements[0])
}

function is_nullish(api: TypeScriptApi, node: ts.Node): node is ts.BinaryExpression {
	return (
		api.isBinaryExpression(node) && node.operatorToken.kind === api.SyntaxKind.QuestionQuestionToken
	)
}

function is_clause(api: TypeScriptApi, node: ts.Node): node is ts.CaseOrDefaultClause {
	return api.isCaseClause(node) || api.isDefaultClause(node)
}

function arms_of(api: TypeScriptApi, node: ts.Node): Array<Arm> {
	if (api.isIfStatement(node)) return if_arms(api, node)
	if (is_clause(api, node)) return clause_arms(api, node)
	if (is_nullish(api, node)) return [expression_arm('?? right side', node.right)]
	if (!api.isConditionalExpression(node)) return []

	return [
		expression_arm('?: true branch', node.whenTrue),
		expression_arm('?: false branch', node.whenFalse),
	]
}

function line_of(source: ts.SourceFile, node: ts.Node): number {
	return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}

function is_changed(lines: ChangedLines, line: number): boolean {
	return lines === undefined || lines.has(line)
}

function each_node(api: TypeScriptApi, node: ts.Node, visit: (node: ts.Node) => void): void {
	visit(node)
	api.forEachChild(node, (child) => {
		each_node(api, child, visit)
	})
}

function changed_arms(api: TypeScriptApi, source: ts.SourceFile, lines: ChangedLines): Array<Arm> {
	const arms: Array<Arm> = []

	each_node(api, source, (node) => {
		const is_branch_changed = is_changed(lines, line_of(source, node))

		for (const arm of arms_of(api, node)) {
			if (is_branch_changed || is_changed(lines, line_of(source, arm.node))) arms.push(arm)
		}
	})

	return arms
}

// One probe hunk per arm of a changed branch in `content`, in source order.
function branch_hunks(
	api: TypeScriptApi,
	file: string,
	content: string,
	lines: ChangedLines,
): Array<Hunk> {
	if (!test_pinned_functions.is_script(file)) return []
	const source = api.createSourceFile(file, content, api.ScriptTarget.Latest, true)

	return changed_arms(api, source, lines).map((arm) => ({
		...test_pinned_functions.stub_hunk(
			file,
			source,
			{ name: arm.name, extent: arm.node, body: arm.node },
			arm.replacement,
		),
		is_branch: true,
	}))
}

function hunk_lines(hunk: Hunk): Array<number> {
	return Array.from({ length: hunk.new_count }, (_unused, index) => hunk.new_start + index)
}

// Each changed file's 1-based changed lines; a pure deletion changes none.
function changed_lines(hunks: ReadonlyArray<Hunk>): Map<string, Set<number>> {
	const by_file = new Map<string, Set<number>>()

	for (const hunk of hunks) {
		by_file.set(hunk.file, new Set([...(by_file.get(hunk.file) ?? []), ...hunk_lines(hunk)]))
	}

	return by_file
}

// The branch probes of the changed files' `hunks` (a `-U0` diff's, before any grouping) and of the
// `added` files; none without `typescript`.
async function read(
	hunks: ReadonlyArray<Hunk>,
	added: ReadonlyArray<string>,
): Promise<Array<Hunk>> {
	const api = review_code_tree.load_typescript(process.cwd())
	if (api === undefined) return []
	const changed = changed_lines(hunks)
	const files = [...changed.keys(), ...added]
	const contents = await Promise.all(files.map(async (file) => await readFile(file, 'utf8')))

	return files.flatMap((file, index) =>
		branch_hunks(api, file, contents[index] ?? '', changed.get(file)),
	)
}

const test_pinned_branches = { branch_hunks, changed_lines, read }

export { test_pinned_branches }
