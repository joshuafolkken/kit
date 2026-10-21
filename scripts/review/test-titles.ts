import type ts from 'typescript'
import type { TypeScriptApi } from './comment-ranges'

// The tests a test file declares, each as its full name — the titles of the `describe` blocks around it
// joined to its own `it` / `test` title — so two tests with the same title under different blocks
// stay apart.
//
// **Read from the TypeScript parser, never from a pattern**: a title holding a quote or a bracket, or
// a call split over lines, is exactly what a hand-written scanner misreads. `it.skip(…)`,
// `test.each([…])(…)` and `describe.concurrent(…)` are the same test with a modifier, so a call
// counts by the names its callee chain is built from: Playwright's `test.describe(…)` is a block and
// its `test.step(…)` is part of the test around it, never a test. A template title with substitutions is kept
// as its source text; a title held in a variable has no text to compare and is not listed.
//
// **A `describe` is a name, never a test**: renaming one moves the tests under it, and removing it
// removes them, so only the `it` / `test` calls are listed.

const BLOCK_FUNCTION = 'describe'
const STEP_FUNCTION = 'step'
const TEST_FUNCTIONS: ReadonlySet<string> = new Set(['it', 'test'])
const TITLE_SEPARATOR = ' > '
const VIRTUAL_FILE_NAME = 'test-titles.ts'

type Prefix = ReadonlyArray<string>

interface NamedCall {
	chain: ReadonlyArray<string>
	title: string
}

interface Walk {
	api: TypeScriptApi
	source: ts.SourceFile
	into: Array<string>
}

function member_name(api: TypeScriptApi, expression: ts.Expression): ReadonlyArray<string> {
	return api.isPropertyAccessExpression(expression) ? [expression.name.text] : []
}

// The names a callee chain is built from, root first: `test.describe.parallel` is
// `['test', 'describe', 'parallel']`, and `it.each([…])` is `['it', 'each']`.
function callee_chain(
	api: TypeScriptApi,
	expression: ts.Expression,
): ReadonlyArray<string> | undefined {
	if (api.isIdentifier(expression)) return [expression.text]
	const is_chained = api.isPropertyAccessExpression(expression) || api.isCallExpression(expression)
	const chain = is_chained ? callee_chain(api, expression.expression) : undefined

	return chain === undefined ? undefined : [...chain, ...member_name(api, expression)]
}

function is_block(chain: ReadonlyArray<string>): boolean {
	return chain.includes(BLOCK_FUNCTION)
}

function is_test(chain: ReadonlyArray<string>): boolean {
	const [root = ''] = chain

	return TEST_FUNCTIONS.has(root) && !is_block(chain) && !chain.includes(STEP_FUNCTION)
}

// Only a string or a template can be a title: the array `it.each([…])` is first called with is the
// table of cases, not a name.
function title_of(walk: Walk, call: ts.CallExpression): string | undefined {
	const [first] = call.arguments

	if (first === undefined) return undefined
	if (walk.api.isStringLiteralLike(first)) return first.text

	return walk.api.isTemplateExpression(first) ? first.getText(walk.source) : undefined
}

function named_call(walk: Walk, node: ts.Node): NamedCall | undefined {
	if (!walk.api.isCallExpression(node)) return undefined
	const chain = callee_chain(walk.api, node.expression)
	const title = chain === undefined ? undefined : title_of(walk, node)

	return chain === undefined || title === undefined ? undefined : { chain, title }
}

// The block titles a call adds to the name of everything inside it: a `describe` adds its own, a
// test is listed and adds nothing further down, and any other node passes its prefix through.
function entered(walk: Walk, call: NamedCall | undefined, prefix: Prefix): Prefix {
	if (call === undefined) return prefix
	const named = [...prefix, call.title]

	if (is_test(call.chain)) walk.into.push(named.join(TITLE_SEPARATOR))

	return is_block(call.chain) ? named : prefix
}

function visit(walk: Walk, node: ts.Node, prefix: Prefix): void {
	const inner = entered(walk, named_call(walk, node), prefix)

	walk.api.forEachChild(node, (child) => {
		visit(walk, child, inner)
	})
}

function titles_of(api: TypeScriptApi, text: string): ReadonlyArray<string> {
	const source = api.createSourceFile(VIRTUAL_FILE_NAME, text, api.ScriptTarget.Latest, true)
	const into: Array<string> = []

	visit({ api, source, into }, source, [])

	return into
}

// The title a test carries itself, without the blocks around it.
function leaf_of(full_name: string): string {
	return full_name.split(TITLE_SEPARATOR).at(-1) ?? full_name
}

const test_titles = { leaf_of, titles_of }

export { test_titles }
