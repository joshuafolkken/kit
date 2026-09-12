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
// **The review boundary sits on whatever call the main line spends the review inside**, and since
// joshuafolkken/kit#1855 that is an `Agent` call rather than a `Skill` one. Before it, the main line
// loaded `/code-review` through the `Skill` tool and that call returned three to four minutes later
// with the finding list — so the `Skill(code-review)` call carried the review's whole duration and
// was the marker. #1855 moved the review into a forked subagent launched with the `Agent` tool, and
// the main line no longer loads the skill at all: the `Skill(code-review)` call now lives inside the
// fork's own transcript, where it returns instantly (it only loads the skill text), and the review's
// real wall clock is the fork's own `Read`/`grep` spans. Those spans carry no marker of their own, so
// they inherit the marker of the parent span they run inside — the `Agent` call (`time-overlap.ts`,
// joshuafolkken/kit#1439). Left unmarked that parent deletes the phase rather than moving it, which is
// the ~0 ms `review` joshuafolkken/kit#1846 measured. So the `Agent` launch is marked here, exactly
// as the `Skill` call was, and the old `Skill(code-review)` marker stays for pre-#1855 transcripts.
//
// **The launch is recognized by its prompt carrying both `/code-review` and `review:attest`.** The
// first is the instruction to invoke the review skill; the second is the attestation line
// `pnpm josh review:brief` emits into the brief the launch passes verbatim (joshuafolkken/kit#1522).
// Neither alone is enough: an investigation subagent about the review tooling quotes `/code-review`
// in prose and is handed no brief, so `review:attest` is what tells a genuine review launch from a
// discussion of one — measured against five real launches, it admits the review and rejects every
// investigation.

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

// The forked review launch (joshuafolkken/kit#1846). `Agent` is the tool the main line spawns the
// review subagent with, and `prompt` is where the instruction to it lives.
const AGENT_TOOL = 'Agent'
const PROMPT_KEY = 'prompt'
// Both must be present. `/code-review` is the invocation the launch tells the subagent to run;
// `review:attest` is the attestation line the passed-through `review:brief` carries and a discussion
// of the review never does — so the pair admits a genuine review launch and rejects an investigation
// subagent that merely mentions the review tooling.
const REVIEW_INVOCATION = '/code-review'
const REVIEW_ATTEST = 'review:attest'

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

// One string field of a call's input, or `''` where the input is not a record or the field is not a
// string. Shared by the two calls that read one — the skill name and the agent prompt — so the
// record guard exists once.
function string_field(input: unknown, key: string): string {
	if (!json_value.is_record(input)) return ''

	const value = input[key]

	return typeof value === 'string' ? value : ''
}

function skill_name(input: unknown): string {
	return string_field(input, SKILL_KEY)
}

// An `Agent` launch's boundary: the review marker when its prompt is a genuine code-review run, and
// no marker otherwise.
function agent_marker(input: unknown): PhaseMarker {
	const prompt = string_field(input, PROMPT_KEY)
	const is_review = prompt.includes(REVIEW_INVOCATION) && prompt.includes(REVIEW_ATTEST)

	return is_review ? REVIEW_MARKER : NO_MARKER
}

// A non-Bash call's boundary, read from the tool name and its input.
function tool_marker(name: string, input: unknown): PhaseMarker {
	if (EDIT_TOOLS.has(name)) return EDIT_MARKER
	if (name === AGENT_TOOL) return agent_marker(input)
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
// **The declaration is read from the one chained command that makes it, not from the call as a
// whole.** `&&`, `||` and `;` join independent commands into a single Bash call, and only one of them
// is the add — so a call that touched another issue's labels first (parking one child and starting
// another, or removing the label before adding it) would have its *leftmost* issue path captured. The
// lookahead on the pattern above rules out the removal form; splitting rules out every other one, and
// it has to be ruled out here rather than corrected later, because under lanes this declaration is
// the only evidence there is.
// The surrounding whitespace is deliberately not matched: neither test below is anchored, so the
// spaces a split leaves on a part change nothing, and `\s*` on both sides of an alternation is the
// shape `sonarjs/super-linear-regex` refuses.
const COMMAND_SEPARATOR = /&&|\|\||;/u

function label_issue(part: string): number {
	const matched = ISSUE_LABELS_PATTERN.exec(part)

	return matched?.[1] === undefined ? NO_ISSUE : Number(matched[1])
}

function bash_issue(command: string): number {
	for (const part of command.split(COMMAND_SEPARATOR)) {
		if (is_in_progress_label(part)) return label_issue(part)
	}

	return NO_ISSUE
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
