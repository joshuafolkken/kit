import { data, Evaluator, Lexer, Parser } from '@actions/expressions'

// Evaluating a workflow condition with GitHub's own expression engine, rather than matching
// substrings in it. A text match proves the clause was written; only an evaluation proves that a
// given update cannot reach the step it guards (kit#802).

// A plain nested record of strings, mirroring the `steps.<id>.outputs.<name>` and `github.<field>`
// shapes a condition reads. Its top-level keys are the context names the parser is given, so the
// context under test and the references the expression is allowed to make cannot drift apart.
interface ContextTree {
	[key: string]: string | ContextTree
}

// A skipped step publishes no outputs, and GitHub renders every missing reference as the empty
// string rather than failing the expression — so an empty value is how a skipped step is modelled.
function to_dictionary(tree: ContextTree): data.Dictionary {
	const pairs = Object.entries(tree).map(([key, value]) => ({
		key,
		value: typeof value === 'string' ? new data.StringData(value) : to_dictionary(value),
	}))

	return new data.Dictionary(...pairs)
}

// The context roots and the nesting key every workflow condition addresses. Declared here rather
// than in each guard so the tree a condition is evaluated against and the reference path asserted on
// are spelled the same way in one place.
const STEPS_CONTEXT = 'steps'
const GITHUB_CONTEXT = 'github'
const OUTPUTS_KEY = 'outputs'

// `cancelled()` is a workflow status function, and the expression package implements none of them:
// they answer what happened to the run so far, which is a property of the run rather than of the
// expression. Every run these guards describe is one that reached its steps and was not cancelled,
// so `false` is its value throughout — and pinning it here is what keeps a condition written with
// it evaluable, instead of falling back to a substring match on the clause.
function cancelled(): data.ExpressionData {
	return new data.BooleanData(false)
}

const STATUS_FUNCTIONS = [{ name: 'cancelled', minArgs: 0, maxArgs: 0, call: cancelled }]
const STATUS_FUNCTION_MAP = new Map(STATUS_FUNCTIONS.map((status) => [status.name, status]))

function evaluate(expression: string, context: ContextTree): data.ExpressionData {
	const lexed = new Lexer(expression).lex()
	const parsed = new Parser(lexed.tokens, Object.keys(context), STATUS_FUNCTIONS).parse()

	return new Evaluator(parsed, to_dictionary(context), STATUS_FUNCTION_MAP).evaluate()
}

function evaluate_condition(condition: string, context: ContextTree): boolean {
	const result = evaluate(condition, context)
	if (result.kind !== data.Kind.Boolean) throw new Error('the gate is not a boolean expression')

	return result.value
}

// A workflow value such as a concurrency group is a template rather than a single expression:
// GitHub interpolates each `${{ … }}` segment into the literal text around it. **Non-greedy is
// load-bearing**: a greedy match would run from the first `${{` to the last `}}` and swallow the
// literal text between two segments, so a value built from several of them — which the concurrency
// group is — would be lexed as one malformed expression rather than interpolated piece by piece.
const INTERPOLATION = /\$\{\{(.*?)\}\}/gu

// Every value GitHub interpolates is coerced to a string, so the segments are evaluated and
// concatenated the same way. This is what lets a guard assert on the group two events resolve to
// rather than on the text of the clause that produces it.
function evaluate_template(template: string, context: ContextTree): string {
	let rendered = ''
	let consumed = 0

	for (const match of template.matchAll(INTERPOLATION)) {
		const expression = match[1] ?? ''

		rendered += template.slice(consumed, match.index) + evaluate(expression, context).coerceString()
		consumed = match.index + match[0].length
	}

	return rendered + template.slice(consumed)
}

const workflow_expression_fixture = {
	STEPS_CONTEXT,
	GITHUB_CONTEXT,
	OUTPUTS_KEY,
	evaluate_condition,
	evaluate_template,
}

export { workflow_expression_fixture, type ContextTree }
