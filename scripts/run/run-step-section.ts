import { document_section_cli } from '#scripts/document/document-section-cli'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_step, type StepAction } from './run-step'
import { run_step_section_once } from './run-step-section-once'

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
const CHAIN_RULE = 'chain-rule.md'
const CHAIN = reference(CHAIN_RULE, 'Run the review-to-merge chain')
const PROGRESS = 'backlogrun-progress.md'
// The chain's own commands, which print their row themselves (`print_once`); `run:step` prints the
// `ship` row too, for the `ship --review` it hands. `followup` and `run:progress` print theirs too.
const SHIP = 'ship'
const REVIEW = 'run:review'
const PROGRESS_WATCHER = 'run:progress'
// `run:park` and `run:pause` print the subsection their ending follows (joshuafolkken/kit#5842), so
// the reader never opens the whole document. The pause's names every entry's branch — `fullrun` /
// `halfrun` stop, `backlogrun` continues — since all of them pause; a lane child's park is its stop.
const PRE_GATE_CUT = 'pre-gate-cut.md'
const PARK = 'run:park'
const PAUSE = 'run:pause'
const PARK_AND_CONTINUE = reference('backlogrun-park.md', 'park and continue')
// Rows both tables carry — the step's and the driver's.
const STEPS = 'backlogrun-steps.md'
const LOOP = reference(STEPS, 'The loop')
const RETROSPECTIVE_KEY = 'retrospective'
const RETROSPECTIVE = reference('retrospective.md', 'The end-of-run retrospective')
const HUMAN_REVIEW = reference('needs-human-review.md', '`needs-human-review`')
const EPIC_CHILDREN = reference(PROGRESS, "Running a named epic's children")

// Keyed on a verdict token, or on the josh subcommand a command action runs. An action with no row —
// `wait`, `stop`, a `decide:` line — has no rule to read beyond its own line.
const GOVERNING_SECTIONS: ReadonlyMap<string, SectionReference> = new Map([
	[ENTRY, reference('split-assessment.md', 'The question')],
	[run_step.IMPLEMENT, CHAIN],
	[run_step.HUMAN_REVIEW, HUMAN_REVIEW],
	[run_step.UPDATE_DEPS, reference('latest-gate.md', 'The dependency update')],
	['followup', reference('followup.md', 'Run `pnpm josh followup`')],
	[PROGRESS_WATCHER, reference('progress-watcher.md', 'Progress while the run is quiet')],
	['run:merge', EPIC_CHILDREN],
	['backlog:next', LOOP],
	['run:cut', reference(PRE_GATE_CUT, 'Resuming')],
	[SHIP, CHAIN],
	[REVIEW, CHAIN],
	[RETROSPECTIVE_KEY, RETROSPECTIVE],
	['run:carry', reference(PROGRESS, 'The hand-off')],
	[PARK, PARK_AND_CONTINUE],
	[PAUSE, reference('prerequisite.md', "Each entry's branch, and the pause")],
])

// **A lane child reads its own step of the chain, never the whole of it** (joshuafolkken/kit#5016):
// the chain's step 1 runs `josh main:merge` (in `josh run:chain`), which a lane child leaves to ship's sync, and a
// child handed the whole section ran it, moving the tree its scoped pair was green on. The step is
// the chain's labelled step 0, cited where it stands, so it is written once; it ends at the sibling
// item `1.`, so a blank line inside it would cut it short. A stopped ship's report reads it too.
const LANE_CHILD_STEP = reference(CHAIN_RULE, 'A lane child')
const LANE_CHILD_SECTIONS: ReadonlyMap<string, SectionReference> = new Map([
	[run_step.IMPLEMENT, LANE_CHILD_STEP],
	[SHIP, LANE_CHILD_STEP],
	[REVIEW, LANE_CHILD_STEP],
	[PARK, reference(PRE_GATE_CUT, 'A lane child records its park before it stops')],
])

// **A `backlog:drive` verdict handed to a session carries its governing sections** (joshuafolkken/kit#5920):
// keyed on the verdict's prefix, first match wins, so `merge human-review` stands above `merge`. A loop
// row carries "The loop" — what the session does — beside the section the row needs.
const DRIVER_SECTIONS: ReadonlyArray<readonly [string, ReadonlyArray<SectionReference>]> = [
	[RETROSPECTIVE_KEY, [RETROSPECTIVE]],
	['merge human-review', [HUMAN_REVIEW]],
	['triage', [LOOP, reference(STEPS, 'Resolve what the plan can resolve')]],
	['judge', [LOOP, reference('docs/josh-commands-backlog.md', '`josh auto-ok:judge`')]],
	['launch #', [LOOP, PARK_AND_CONTINUE]],
	['merge', [LOOP, EPIC_CHILDREN]],
	[
		'epic #',
		[
			reference(STEPS, 'Named issues run first, in order'),
			reference(STEPS, 'The session cut is inside the invocation'),
		],
	],
	['watch', [LOOP, RETROSPECTIVE]],
]

// A section that does not resolve — a document a consumer does not ship — is named instead of
// failing the hand-off; the table's test keeps every row resolving in kit.
function carried_text(found: SectionReference, root: string): string {
	return (
		document_section_cli.section_text(found.document, found.heading, root) ??
		`\`${found.document}\` → "${found.heading}"`
	)
}

function driver_sections(verdict: string, root: string = process.cwd()): string {
	const found = DRIVER_SECTIONS.find(([prefix]) => verdict.startsWith(prefix))

	return (found?.[1] ?? [LOOP]).map((section) => carried_text(section, root)).join('\n')
}

function key_of(action: StepAction): string {
	if (action.kind !== 'command') return action.line

	const [subcommand = ''] = action.line.slice(JOSH_PREFIX.length).split(COMMAND_SEPARATOR)

	return subcommand
}

function section_for(key: string, is_lane_child: boolean): SectionReference | undefined {
	const lane_child_section = is_lane_child ? LANE_CHILD_SECTIONS.get(key) : undefined

	return lane_child_section ?? GOVERNING_SECTIONS.get(key)
}

// Printed through `doc:section` itself, so the extent, the Bash-cap split and the refusal of an
// unresolved heading are that command's, never a second copy of them. Each print is recorded for the
// session, so a command printing its own row after it prints one line (`print_once`).
function print_section(key: string, root: string = process.cwd(), is_lane_child = false): number {
	const found = section_for(key, is_lane_child)

	if (found === undefined) return SUCCESS_EXIT_CODE
	const exit_code = document_section_cli.run([found.document, found.heading], root)

	if (exit_code === SUCCESS_EXIT_CODE) run_step_section_once.record(found)

	return exit_code
}

// **A command's own row prints once per session** (joshuafolkken/kit#5626): `run:review` and `ship`
// print the section that governs them, so the reader spends no `doc:section` turn on it, and a
// section this session already printed — by `run:step`, or by the other command — is one line.
function print_once(key: string, root: string = process.cwd()): number {
	const is_lane_child = lane_child_marker.is_child_of(root)
	const found = section_for(key, is_lane_child)

	if (found === undefined || !run_step_section_once.is_recorded(found)) {
		return print_section(key, root, is_lane_child)
	}

	console.info(run_step_section_once.repeat_line(found))

	return SUCCESS_EXIT_CODE
}

function print_for(
	action: StepAction,
	is_lane_child = false,
	root: string = process.cwd(),
): number {
	return print_section(key_of(action), root, is_lane_child)
}

const run_step_section = {
	DRIVER_SECTIONS,
	ENTRY,
	GOVERNING_SECTIONS,
	PARK,
	PAUSE,
	PROGRESS: PROGRESS_WATCHER,
	RETROSPECTIVE: RETROSPECTIVE_KEY,
	LANE_CHILD_SECTIONS,
	driver_sections,
	key_of,
	print_for,
	print_once,
	print_section,
}

export type { SectionReference }
export { run_step_section }
