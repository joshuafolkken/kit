import { UNORDERED_DEPENDENCIES } from './git-epic-parse'
import { DEPENDENCY_ARROW, to_issue_reference } from './git-epic-reference'

// The epic body is the machine-readable half of the epic contract: `scripts/git/git-epic-close.ts`
// reads the task list to decide when the batch is finished, and the order-unrecorded warning reads
// the `Dependencies` section. Generating both from the same input is what keeps them from
// disagreeing with each other, or with the run command printed next to them.

const RATIONALE_PLACEHOLDER = '<why the work was split this way>'

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

function build_epic_body(input: EpicBodyInput): string {
	return [
		'## Split rationale',
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

export { git_epic_body }
export type { EpicBodyInput }
