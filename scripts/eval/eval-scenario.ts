import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

// A scenario is a rule from the distributed documents, restated as something an agent either does or
// does not do. joshuafolkken/kit#855: the documents grew because every observed violation was
// answered with more prose, and prose was the only evidence either way — so a rule that never worked
// looked exactly like one that did. What makes this measurable is judging the transcript, never the
// reply: `should_call` / `should_not_call` name tool invocations, which are facts about the run.

// Enough turns to read the documents, act, and report; a scenario that needs more is usually one
// measuring a whole workflow rather than a rule, and says so by raising its own limit.
const DEFAULT_MAX_TURNS = 8

function is_valid_pattern(pattern: string): boolean {
	try {
		return Boolean(new RegExp(pattern, 'u'))
	} catch {
		return false
	}
}

const TOOL_EXPECTATION_SCHEMA = z.strictObject({
	tool: z.string().min(1),
	// Matched against the JSON-encoded tool input, so a Bash command, a file path and a flag are all
	// reachable with one field. Absent means the tool name alone decides. Compiled here rather than at
	// judge time: an invalid pattern would otherwise throw after the paid sessions had already run,
	// taking the summary and every remaining scenario with it.
	input_matches: z
		.string()
		.refine(is_valid_pattern, { message: 'must be a valid unicode regular expression' })
		.optional(),
	// Why this call is the evidence. Printed beside a failure, because "Edit was called" says nothing
	// about which rule that broke.
	because: z.string().min(1),
})

// Both sides are full expectations rather than bare tool names. Matching by name alone read
// `Read(CLAUDE.md) → Bash(gh …) → Read(SKILL.md)` as ordered, because *a* Read came first — which is
// the exact sequence the rule this shape exists to measure forbids.
const ORDER_EXPECTATION_SCHEMA = z.strictObject({
	before: TOOL_EXPECTATION_SCHEMA.omit({ because: true }),
	after: TOOL_EXPECTATION_SCHEMA.omit({ because: true }),
	because: z.string().min(1),
})

// Strict, so a misspelled key is an error rather than a silently dropped expectation. A scenario
// declaring `should_not_calls` would otherwise parse, measure nothing, and read as coverage.
const SCENARIO_SCHEMA = z.strictObject({
	name: z.string().min(1),
	// The document section this measures, so a failing scenario points at the prose to change.
	rule: z.string().min(1),
	prompt: z.string().min(1),
	// Files the sandbox gets on top of the distributed documents, as path → contents.
	fixture_files: z.record(z.string(), z.string()).default({}),
	max_turns: z.number().int().positive().default(DEFAULT_MAX_TURNS),
	should_call: z.array(TOOL_EXPECTATION_SCHEMA).default([]),
	should_not_call: z.array(TOOL_EXPECTATION_SCHEMA).default([]),
	should_call_in_order: z.array(ORDER_EXPECTATION_SCHEMA).default([]),
})

type Scenario = z.infer<typeof SCENARIO_SCHEMA>
type ToolExpectation = z.infer<typeof TOOL_EXPECTATION_SCHEMA>
// An expectation without its reason: what the two halves of an ordering pair are.
type ToolMatcher = Omit<ToolExpectation, 'because'>
type OrderExpectation = z.infer<typeof ORDER_EXPECTATION_SCHEMA>

const SCENARIO_EXTENSION = '.json'

// Parsed with the file name in the error: a scenario suite is read as a batch, and a bare Zod
// message names a field without saying which of a dozen files carries it.
function parsed_json(source_path: string, raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)

		throw new Error(`${path.basename(source_path)}: ${reason}`, { cause: error })
	}
}

function parse_scenario(source_path: string, raw: string): Scenario {
	const result = SCENARIO_SCHEMA.safeParse(parsed_json(source_path, raw))

	if (!result.success) {
		throw new Error(`${path.basename(source_path)}: ${z.prettifyError(result.error)}`)
	}

	return result.data
}

function scenario_paths(directory: string): ReadonlyArray<string> {
	return readdirSync(directory, { encoding: 'utf8' })
		.filter((entry) => entry.endsWith(SCENARIO_EXTENSION))
		.toSorted((left, right) => left.localeCompare(right))
		.map((entry) => path.join(directory, entry))
}

function load_scenarios(directory: string): ReadonlyArray<Scenario> {
	return scenario_paths(directory).map((source_path) =>
		parse_scenario(source_path, readFileSync(source_path, 'utf8')),
	)
}

const eval_scenario = { load_scenarios, parse_scenario, scenario_paths }

export { eval_scenario }
export type { OrderExpectation, Scenario, ToolExpectation, ToolMatcher }
