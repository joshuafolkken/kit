import { cost_attribute } from '#scripts/cost/cost-attribute'
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
// would be a second rule for the same thing. What is left is four: the plan comment, the first
// edit, the code-review invocation, and the instant the workflow itself opened.
//
// **The workflow boundary has two spellings, and both are the same marker** (joshuafolkken/kit#1299).
// A run is not a session: the transcript attributed to an issue reaches back into whatever the
// session was doing before the keyword was typed, so without a marker for "the run starts here"
// that earlier conversation is measured as part of it. Loading the `workflow-commands` skill is the
// first act of every entry point, and writing the `in-progress` label is the first act every one of
// them performs on GitHub — so the earliest of the two is taken and neither is required, which is
// what keeps a delegated unit (whose parent loaded the skill) and a resumed run measurable.
//
// **The code-review skill call carries the review's whole duration**, so it is a marker rather than
// a window boundary: measured on this repository's own transcripts, the `Skill` call for
// `code-review` returns its result three to four minutes later, because the skill runs the review
// and hands back the finding list. A window from the invocation to the next command would instead
// swallow whatever the run did afterwards.

type PhaseMarker = 'none' | 'plan' | 'edit' | 'review' | 'workflow'

const NO_MARKER: PhaseMarker = 'none'
const PLAN_MARKER: PhaseMarker = 'plan'
const EDIT_MARKER: PhaseMarker = 'edit'
const REVIEW_MARKER: PhaseMarker = 'review'
const WORKFLOW_MARKER: PhaseMarker = 'workflow'

// Writing a new file opens implementation exactly as changing an existing one does, so both count.
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const SKILL_TOOL = 'Skill'
const SKILL_KEY = 'skill'
const REVIEW_SKILL = 'code-review'
const WORKFLOW_SKILL = 'workflow-commands'

// The two skill calls that are boundaries, keyed by name. A map rather than a second `if`, so a
// third boundary skill is a row and not another branch through the same function.
const SKILL_MARKERS = new Map<string, PhaseMarker>([
	[REVIEW_SKILL, REVIEW_MARKER],
	[WORKFLOW_SKILL, WORKFLOW_MARKER],
])

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

// **The add form, not the label's name anywhere in the command.** The prerequisite branch removes the
// same label with `-X DELETE …/labels/in-progress`, which is a run ending its hold on an issue rather
// than opening one — matched loosely, that call would move the run's start to somewhere near its end.
// The API path is required alongside it for the reason the plan boundary requires one: a command that
// merely quotes the flag, which this repository's own issue bodies do, is not the call.
// The number is captured because the same call is the only place a run states, in its own transcript,
// which issue it is running (joshuafolkken/kit#1617). Capturing changes nothing for the `test` above
// it — the boundary is still the whole match.
// **The trailing `(?!\/)` is what keeps the capture on the issue being labelled.** `labels[]=in-progress`
// only has to appear somewhere in the command, and the capture takes the leftmost match — so one call
// that removed another issue's label before adding this one would declare the run as that other issue,
// with nothing to correct it because under lanes this declaration is the only evidence there is. The
// removal form is `…/labels/in-progress`, so refusing a path continued by a slash leaves exactly the
// add form. The `test` above is unaffected: it already required the `labels[]=` field, which the
// removal form does not carry.
const ISSUE_LABELS_PATTERN = /repos\/\S+\/issues\/(\d+)\/labels\b(?!\/)/u
const IN_PROGRESS_FIELD = 'labels[]=in-progress'

// "This call declares no issue", which is the attribution's own sentinel rather than a second one:
// what `bash_issue` returns is read by `cost_attribute` and by nothing else, so two spellings of "no
// issue" could only drift apart.
const NO_ISSUE = cost_attribute.UNATTRIBUTED_KEY

function skill_name(input: unknown): string {
	if (!json_value.is_record(input)) return ''

	const skill = input[SKILL_KEY]

	return typeof skill === 'string' ? skill : ''
}

// A non-Bash call's boundary, read from the tool name and its input.
function tool_marker(name: string, input: unknown): PhaseMarker {
	if (EDIT_TOOLS.has(name)) return EDIT_MARKER
	if (name !== SKILL_TOOL) return NO_MARKER

	return SKILL_MARKERS.get(skill_name(input)) ?? NO_MARKER
}

function is_api_body_write(command: string): boolean {
	return ISSUE_API_PATTERN.test(command) && BODY_FIELD_PATTERN.test(command)
}

function is_issue_comment(command: string): boolean {
	return ISSUE_COMMENT_PATTERN.test(command) && BODY_FLAG_PATTERN.test(command)
}

function is_in_progress_label(command: string): boolean {
	return ISSUE_LABELS_PATTERN.test(command) && command.includes(IN_PROGRESS_FIELD)
}

// Which issue a Bash call declares its run to be running, or `undefined` where it declares nothing.
//
// **Attribution's other evidence is the branch, and a lane run has none to give**
// (joshuafolkken/kit#1617): the session writing the transcript stays on the default branch while the
// child's commands run in a linked work tree, so `gitBranch` says `main` on every line and
// `cost_attribute` has nothing to fill forward. This call is what is left, and it is the right thing
// to be left with — it is the run naming its own issue, once, and `time-sessions.ts` already treats
// the same call as the statement of *whose* run a session is.
//
// **Only the `in-progress` add form counts**, exactly as the marker above: the `-X DELETE` form ends a
// run's hold rather than opening one, and every other `issues/<N>/…` call a session makes — an epic
// insertion, a plan comment, a completion comment — names an issue it is not running.
function bash_issue(command: string): number {
	if (!is_in_progress_label(command)) return NO_ISSUE

	const matched = ISSUE_LABELS_PATTERN.exec(command)

	return matched?.[1] === undefined ? NO_ISSUE : Number(matched[1])
}

// A Bash call's boundary, read from the command it runs. Two are detected here — writing a body to
// an issue, and labelling one `in-progress` — because the rest of what Bash marks is already a
// `pnpm josh <cmd>` name.
//
// **Which of those writes is the plan is not decided here**: the completion comment and an
// auto-decision log take the same shape, so `time-phases.ts` accepts only a marker that closes
// before the first edit. The label carries no body, so the two tests cannot both match one command.
function bash_marker(command: string): PhaseMarker {
	if (is_in_progress_label(command)) return WORKFLOW_MARKER

	return is_api_body_write(command) || is_issue_comment(command) ? PLAN_MARKER : NO_MARKER
}

const time_markers = {
	NO_MARKER,
	PLAN_MARKER,
	EDIT_MARKER,
	REVIEW_MARKER,
	WORKFLOW_MARKER,
	NO_ISSUE,
	tool_marker,
	bash_marker,
	bash_issue,
}

export type { PhaseMarker }
export { time_markers }
