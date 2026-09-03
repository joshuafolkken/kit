import { json_value } from '#scripts/json-value'

// Which workflow boundary a tool call marks (joshuafolkken/kit#1269).
//
// The per-tool totals answer "which command is slow" and say nothing about "which *stage* is long".
// A stage is bounded by things a transcript can be read for, so this module is the one rule for what
// counts as a boundary — and it is deliberately about **recognizable commands, never durations**: a
// boundary guessed from "this interval looks like a review" would move whenever a run got faster,
// which is the one thing a measurement used to compare two runs must not do.
//
// **Only the boundaries `josh_command` cannot already express live here.** `gate`, `pr` and `merge`
// are `pnpm josh <cmd>` invocations that `time-spans.ts` already names, and re-detecting them here
// would be a second rule for the same thing. What is left is three: the plan comment, the first
// edit, and the code-review invocation.
//
// **The code-review skill call carries the review's whole duration**, so it is a marker rather than
// a window boundary: measured on this repository's own transcripts, the `Skill` call for
// `code-review` returns its result three to four minutes later, because the skill runs the review
// and hands back the finding list. A window from the invocation to the next command would instead
// swallow whatever the run did afterwards.

type PhaseMarker = 'none' | 'plan' | 'edit' | 'review'

const NO_MARKER: PhaseMarker = 'none'
const PLAN_MARKER: PhaseMarker = 'plan'
const EDIT_MARKER: PhaseMarker = 'edit'
const REVIEW_MARKER: PhaseMarker = 'review'

// Writing a new file opens implementation exactly as changing an existing one does, so both count.
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const SKILL_TOOL = 'Skill'
const SKILL_KEY = 'skill'
const REVIEW_SKILL = 'code-review'

// **The `repos/` prefix is what makes this the API path and not any mention of an issue.** Matching a
// bare `issues/<N>` alongside a `body=` charged the plan boundary to
// `pnpm josh notify --issue-url "https://github.com/<owner>/<repo>/issues/<N>" --body=…`, which every
// mid-run stop sends — so planning would have ended at whichever notification went out first.
const ISSUE_API_PATTERN = /repos\/\S+\/issues\/\d+/u

// The field that separates posting a plan from the other calls made against the same path. The title
// normalization is `-X PATCH … issues/<N> -f title=…` and the label call is `issues/<N>/labels`;
// neither writes a body, and both run before the plan in every `fullrun`.
const BODY_FIELD_PATTERN = /\bbody=/u

// `gh issue comment <N> --body …` posts the same comment without an API path, and `--body-file`
// carries no `body=` at all — so a plan posted either way went undetected under the API form alone.
const ISSUE_COMMENT_PATTERN = /\bgh\s+issue\s+comment\b/u
const BODY_FLAG_PATTERN = /--body(?:-file)?\b/u

function skill_name(input: unknown): string {
	if (!json_value.is_record(input)) return ''

	const skill = input[SKILL_KEY]

	return typeof skill === 'string' ? skill : ''
}

// A non-Bash call's boundary, read from the tool name and its input.
function tool_marker(name: string, input: unknown): PhaseMarker {
	if (EDIT_TOOLS.has(name)) return EDIT_MARKER
	if (name !== SKILL_TOOL) return NO_MARKER

	return skill_name(input) === REVIEW_SKILL ? REVIEW_MARKER : NO_MARKER
}

function is_api_body_write(command: string): boolean {
	return ISSUE_API_PATTERN.test(command) && BODY_FIELD_PATTERN.test(command)
}

function is_issue_comment(command: string): boolean {
	return ISSUE_COMMENT_PATTERN.test(command) && BODY_FLAG_PATTERN.test(command)
}

// A Bash call's boundary, read from the command it runs. Only one is detected here — writing a body
// to an issue — because the rest of what Bash marks is already a `pnpm josh <cmd>` name.
//
// **Which of those writes is the plan is not decided here**: the completion comment and an
// auto-decision log take the same shape, so `time-phases.ts` accepts only a marker that closes
// before the first edit.
function bash_marker(command: string): PhaseMarker {
	return is_api_body_write(command) || is_issue_comment(command) ? PLAN_MARKER : NO_MARKER
}

const time_markers = {
	NO_MARKER,
	PLAN_MARKER,
	EDIT_MARKER,
	REVIEW_MARKER,
	tool_marker,
	bash_marker,
}

export type { PhaseMarker }
export { time_markers }
