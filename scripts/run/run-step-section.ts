import { document_section_cli } from '#scripts/document/document-section-cli'
import { run_step, type StepAction } from './run-step'

// The section that governs each action `run:step` and `run:entry` print — the one table the action →
// rule mapping lives in, so the manifests no longer carry a route table the reader walks to find it.
// The command prints the section after its action line, which saves the `doc:section` turn the reader
// would otherwise spend fetching a section the action already determined.
//
// **A heading that does not resolve fails the command**, exactly as `doc:section` refuses it: a pointer
// renamed away would otherwise print the action without its rule, and the reader would act unread.

const JOSH_PREFIX = 'pnpm josh '
const COMMAND_SEPARATOR = ' '
const SUCCESS_EXIT_CODE = 0

// The key `run:entry` prints under — not a `run:step` action, but the entry's own read, kept in the
// same table so every mechanically-chosen section has one home.
const ENTRY = 'entry'

interface SectionReference {
	document: string
	heading: string
}

function reference(document: string, heading: string): SectionReference {
	return { document, heading }
}

// The gate's chain governs both the implementation it follows and a stopped ship's report.
const CHAIN = reference('chain-rule.md', 'Run the review-to-merge chain')
const PROGRESS = 'backlogrun-progress.md'

// Keyed on a verdict token, or on the josh subcommand a command action runs. An action with no row —
// `wait`, `stop`, a `decide:` line — has no rule to read beyond its own line.
const GOVERNING_SECTIONS: ReadonlyMap<string, SectionReference> = new Map([
	[ENTRY, reference('split-assessment.md', 'The question')],
	[run_step.IMPLEMENT, CHAIN],
	[run_step.HUMAN_REVIEW, reference('needs-human-review.md', '`needs-human-review`')],
	[run_step.UPDATE_DEPS, reference('latest-gate.md', 'The dependency update')],
	['followup', reference('followup.md', 'Run `pnpm josh followup`')],
	['review:round2', reference('prompts/review.md', 'Review round cap')],
	['run:merge', reference(PROGRESS, "Running a named epic's children")],
	['backlog:next', reference('backlogrun-steps.md', 'The loop')],
	['run:cut', reference('pre-gate-cut.md', 'Resuming')],
	['ship', CHAIN],
	['retrospective', reference('retrospective.md', 'The end-of-run retrospective')],
	['run:carry', reference(PROGRESS, 'The hand-off')],
])

function key_of(action: StepAction): string {
	if (action.kind !== 'command') return action.line

	const [subcommand = ''] = action.line.slice(JOSH_PREFIX.length).split(COMMAND_SEPARATOR)

	return subcommand
}

function section_for(key: string): SectionReference | undefined {
	return GOVERNING_SECTIONS.get(key)
}

// Printed through `doc:section` itself, so the extent, the Bash-cap split and the refusal of an
// unresolved heading are that command's, never a second copy of them.
function print_section(key: string, root: string = process.cwd()): number {
	const found = section_for(key)

	if (found === undefined) return SUCCESS_EXIT_CODE

	return document_section_cli.run([found.document, found.heading], root)
}

function print_for(action: StepAction, root: string = process.cwd()): number {
	return print_section(key_of(action), root)
}

const run_step_section = {
	ENTRY,
	GOVERNING_SECTIONS,
	key_of,
	print_for,
	print_section,
}

export type { SectionReference }
export { run_step_section }
