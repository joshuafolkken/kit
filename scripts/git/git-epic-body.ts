import { UNORDERED_DEPENDENCIES } from './git-epic-parse'
import { DEPENDENCY_ARROW, to_issue_reference } from './git-epic-reference'

// The epic body is the machine-readable half of the epic contract: `scripts/git/git-epic-close.ts`
// reads the task list to decide when the batch is finished, and the order-unrecorded warning reads
// the `Dependencies` section. Generating both from the same input is what keeps them from
// disagreeing with each other, or with the run command printed next to them.

const RATIONALE_PLACEHOLDER = '<why the work was split this way>'
// Where a creation records its reasoning, including the reasoning for the order `--ordered` declares.
// Exported because `epic:audit`'s unjustified-order check reads it as one of the places a declared
// order's reason may live, and a second spelling of the heading is one that comes to disagree with
// the writer (joshuafolkken/kit#1712).
const SPLIT_RATIONALE_HEADING = '## Split rationale'
// One child declares no order, so there is nothing for the record below to name.
const CHAIN_MINIMUM_LENGTH = 2

interface EpicBodyInput {
	children: ReadonlyArray<number>
	rationale: string
	is_ordered: boolean
	origin?: string | undefined
	// Known when an existing issue is being promoted; absent while a new epic's body is built, since
	// the number is only assigned on creation.
	epic_number?: number | undefined
}

// Task-list syntax, never a bare `#N` link: `git_epic_parse.parse_task_list_issue_numbers` matches
// nothing else, and GitHub only auto-checks a row written this way.
function format_progress(children: ReadonlyArray<number>): string {
	return children.map((child) => `- [ ] ${to_issue_reference(child)}`).join('\n')
}

function format_dependencies(children: ReadonlyArray<number>, is_ordered: boolean): string {
	if (!is_ordered) return UNORDERED_DEPENDENCIES

	return children.map((child) => to_issue_reference(child)).join(DEPENDENCY_ARROW)
}

// The command that runs the batch. `epicrun` takes the epic itself rather than a list of children
// (joshuafolkken/kit#861): it re-reads the state from GitHub each round, so an interrupted run
// resumes without anyone retyping the remaining numbers, and a child that needs a decision is parked
// rather than ending the run.
//
// The epic number is not known while its own body is being built, so the placeholder is filled in by
// `format_run_command` once the issue exists. Bodies written before this change still say
// `queue …`; nothing reads the `Execution` section — the auto-close reads the task list and
// `epic:check` never looks at it — so those epics are unaffected (joshuafolkken/kit#865).
const EPIC_PLACEHOLDER = '<this epic>'

function format_run_command(epic_number: number | undefined): string {
	return `epicrun #${epic_number === undefined ? EPIC_PLACEHOLDER : String(epic_number)}`
}

// A backlink to the Issue this split came from, when the split originated in another repository.
// Written as prose rather than a checkbox row — a checkbox referencing another repository disables
// the auto-close by design, which is right for a real cross-repo child and a trap for a backlink.
function format_origin_section(origin: string | undefined): string {
	if (origin === undefined || origin.length === 0) return ''

	return `\n## Origin\n\n${origin}\n`
}

function to_rationale(rationale: string): string {
	const trimmed = rationale.trim()

	return trimmed.length > 0 ? trimmed : RATIONALE_PLACEHOLDER
}

// The record that `--ordered` itself is the decision behind the chain it writes
// (joshuafolkken/kit#1712).
//
// **Without it every `--ordered` epic is born failing its own audit.** `epic:audit`'s
// unjustified-order check asks where a declared order's reason was recorded, and a creation used to
// record none — the split rationale explains the split in prose that need not name a single issue
// number, so the check found nothing for any of the links and `epicrun` stopped at step one on a
// brand-new epic created exactly as documented.
//
// **It is a real record, not a formality.** `--ordered` is a person stating the order deliberately,
// and this says so, when, and where the reasoning is — which is exactly what the check exists to
// find. It does not make the check vacuous: it names the chain the creation declared, so a link
// typed into the body by hand afterwards is still reported, which is the case the check was filed
// for.
//
// **The chain goes inside backticks.** A line that is *nothing but* a chain is read as part of the
// declaration wherever it sits in the body, so an unquoted one here would declare the order twice.
function format_decisions_section(children: ReadonlyArray<number>, is_ordered: boolean): string {
	if (!is_ordered || children.length < CHAIN_MINIMUM_LENGTH) return ''

	const chain = children.map((child) => to_issue_reference(child)).join(DEPENDENCY_ARROW)

	return [
		'',
		'## Decisions',
		'',
		'### Declared order',
		'',
		`- Order: \`${chain}\`, declared by \`josh epic --ordered\` when this epic was created.`,
		`- Reasoning: see \`${SPLIT_RATIONALE_HEADING}\` above.`,
		'',
	].join('\n')
}

function build_epic_body(input: EpicBodyInput): string {
	return [
		SPLIT_RATIONALE_HEADING,
		'',
		to_rationale(input.rationale),
		format_origin_section(input.origin),
		'## Dependencies',
		'',
		format_dependencies(input.children, input.is_ordered),
		'',
		'## Execution',
		'',
		format_run_command(input.epic_number),
		'',
		'## Progress',
		'',
		format_progress(input.children),
		format_decisions_section(input.children, input.is_ordered),
	].join('\n')
}

// `--ordered` declares that the given argument order is the dependency order, so the pairs the
// relations are applied to are the same pairs the arrow chain names.
function build_dependency_pairs(
	children: ReadonlyArray<number>,
	is_ordered: boolean,
): Array<{ blocked: number; blocker: number }> {
	if (!is_ordered) return []

	return children
		.slice(1)
		.map((blocked, index) => ({ blocked, blocker: children[index] ?? blocked }))
		.filter((pair) => pair.blocked !== pair.blocker)
}

const git_epic_body = {
	EPIC_PLACEHOLDER,
	build_epic_body,
	build_dependency_pairs,
	format_run_command,
}

export { git_epic_body, SPLIT_RATIONALE_HEADING }
export type { EpicBodyInput }
