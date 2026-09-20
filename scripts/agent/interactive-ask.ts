import { z } from 'zod'

// The tools a session uses to ask a person, and how to lift a refused ask out of an exit record
// (joshuafolkken/kit#2201).
//
// **A dispatched lane child cannot ask a person.** It is a headless `claude -p` process, so an
// interactive ask is refused — and with nowhere to route it the turn ends with nothing on the Issue,
// the gap joshuafolkken/kit#2034 measured. Two consumers share the one notion of "an interactive ask":
// the
// `PreToolUse` rule that refuses it in a lane child (`scripts/rules/lane-interactive-ask.ts`), and
// `run:ending`, which reads the refused ask back out of the child's exit record so the parent can put
// the question and its options into the park comment. Both read `INTERACTIVE_TOOLS`, so the set lives
// here rather than in either.

// The tools that ask a person. Kept a set so a second interactive tool is one entry rather than a new
// predicate; `AskUserQuestion` is the one a lane child reached for in the measured runs.
const INTERACTIVE_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion'])

function is_interactive_tool(name: string): boolean {
	return INTERACTIVE_TOOLS.has(name)
}

// `looseObject`, so a payload that carries more fields than these — and an exit record always does —
// parses rather than being rejected for the extras. Every field is optional: a refused ask whose
// options or question text the harness did not preserve still yields what it did.
const OPTION_SCHEMA = z.looseObject({ label: z.string().optional() })
const QUESTION_SCHEMA = z.looseObject({
	question: z.string().optional(),
	options: z.array(OPTION_SCHEMA).optional(),
})
const ASK_INPUT_SCHEMA = z.looseObject({ questions: z.array(QUESTION_SCHEMA).optional() })
const DENIAL_SCHEMA = z.looseObject({
	tool_name: z.string().optional(),
	tool_input: z.unknown().optional(),
})

type AskInput = z.infer<typeof ASK_INPUT_SCHEMA>
type Question = z.infer<typeof QUESTION_SCHEMA>

const UNKNOWN_QUESTION = '(question text unavailable)'
const OPTION_SEPARATOR = ' / '
const QUESTION_SEPARATOR = '; '

// One question's option labels, blanks dropped: the labels are what a person needs to pick between,
// and an option the harness left without one adds nothing to the park comment.
function labels_of(question: Question): ReadonlyArray<string> {
	return (question.options ?? [])
		.map((option) => option.label ?? '')
		.filter((label) => label !== '')
}

// One refused question rendered for the park comment: the text, and its option labels in brackets
// where any survived.
function render_question(question: Question): string {
	const labels = labels_of(question)
	const text = question.question ?? UNKNOWN_QUESTION

	return labels.length === 0 ? text : `${text} [${labels.join(OPTION_SEPARATOR)}]`
}

// The ask input of one denial, or undefined when the denial is not an interactive tool or its input is
// not an ask. Read segment-by-segment so a non-interactive denial in the list is passed over.
function interactive_input(raw: unknown): AskInput | undefined {
	const denial = DENIAL_SCHEMA.safeParse(raw)

	if (!denial.success || !is_interactive_tool(denial.data.tool_name ?? '')) return undefined

	const input = ASK_INPUT_SCHEMA.safeParse(denial.data.tool_input)

	return input.success ? input.data : undefined
}

// The refused interactive ask lifted out of an exit record's `permission_denials`, rendered for the
// park comment — or undefined when no denial was an interactive ask or none carried a question. The
// first interactive denial wins, since a child asks once before it is stopped.
function refused_ask_of(permission_denials: unknown): string | undefined {
	if (!Array.isArray(permission_denials)) return undefined

	const input = permission_denials
		.map((raw) => interactive_input(raw))
		.find((one) => one !== undefined)
	const questions = input?.questions ?? []

	if (questions.length === 0) return undefined

	return questions.map((question) => render_question(question)).join(QUESTION_SEPARATOR)
}

const interactive_ask = { INTERACTIVE_TOOLS, is_interactive_tool, refused_ask_of }

export { interactive_ask }
