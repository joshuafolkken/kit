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

function evaluate_condition(condition: string, context: ContextTree): boolean {
	const lexed = new Lexer(condition).lex()
	const parsed = new Parser(lexed.tokens, Object.keys(context), []).parse()
	const result = new Evaluator(parsed, to_dictionary(context)).evaluate()
	if (result.kind !== data.Kind.Boolean) throw new Error('the gate is not a boolean expression')

	return result.value
}

const workflow_expression_fixture = {
	STEPS_CONTEXT,
	GITHUB_CONTEXT,
	OUTPUTS_KEY,
	evaluate_condition,
}

export { workflow_expression_fixture, type ContextTree }
