import { UNORDERED_DEPENDENCIES } from './git-epic-parse'

// The epic body is the machine-readable half of the epic contract: `scripts/git/git-epic-close.ts`
// reads the task list to decide when the batch is finished, and the order-unrecorded warning reads
// the `Dependencies` section. Generating both from the same input is what keeps them from
// disagreeing with each other, or with the `queue` command printed next to them.

const DEPENDENCY_ARROW = ' -> '
const RATIONALE_PLACEHOLDER = '<why the work was split this way>'

interface EpicBodyInput {
	children: ReadonlyArray<number>
	rationale: string
	is_ordered: boolean
	origin?: string | undefined
}

function to_reference(child: number): string {
	return `#${String(child)}`
}

// Task-list syntax, never a bare `#N` link: `git_epic_parse.parse_task_list_issue_numbers` matches
// nothing else, and GitHub only auto-checks a row written this way.
function format_progress(children: ReadonlyArray<number>): string {
	return children.map((child) => `- [ ] ${to_reference(child)}`).join('\n')
}

function format_dependencies(children: ReadonlyArray<number>, is_ordered: boolean): string {
	if (!is_ordered) return UNORDERED_DEPENDENCIES

	return children.map((child) => to_reference(child)).join(DEPENDENCY_ARROW)
}

// The epic itself is never passed to `queue`: it has no deliverable and no implementation run.
function format_queue_command(children: ReadonlyArray<number>): string {
	return `queue ${children.map((child) => to_reference(child)).join(' ')}`
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
		format_queue_command(input.children),
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
	build_epic_body,
	build_dependency_pairs,
	format_queue_command,
}

export { git_epic_body }
export type { EpicBodyInput }
