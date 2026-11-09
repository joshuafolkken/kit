import { run_step } from './run-step'

// The action → section table `run-step-section.ts` prints from, apart from its printing
// (joshuafolkken/kit#5987): a reader that needs only a key or a row imports this leaf, so a change
// to the printing reaches only the tests of the commands that print.

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
// `run:cut` prints the section its non-trivial verdict follows (joshuafolkken/kit#5953): taking the cut
// has its own key, and the resume keeps the subcommand's, which `run:step` hands as `run:cut --resume`.
const CUT = 'run:cut take'
const RESUME = 'run:cut'
const PARK = 'run:park'
const PAUSE = 'run:pause'
const PARK_AND_CONTINUE = reference('backlogrun-park.md', 'park and continue')
// Rows both tables carry — the step's and the driver's.
const STEPS = 'backlogrun-steps.md'
const LOOP = reference(STEPS, 'The loop')
const RESOLVE = reference(STEPS, 'Resolve what the plan can resolve')
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
	[CUT, reference(PRE_GATE_CUT, 'Taking the cut')],
	[RESUME, reference(PRE_GATE_CUT, 'Resuming')],
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
// the chain's step 0, a section of its own beside the chain (joshuafolkken/kit#5946), so neither
// reader is printed the other's steps. A stopped ship's report reads it too.
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
	['triage', [LOOP, RESOLVE]],
	['judge', [LOOP, reference('docs/josh-commands-backlog.md', '`josh auto-ok:judge`')]],
	// A refused launch is parked `run:stalled` by the driver (joshuafolkken/kit#6878): its section is the
	// retry of a recovered mechanical failure, never "park and continue".
	['launch #', [LOOP, RESOLVE]],
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

const run_step_section_table = {
	CUT,
	DRIVER_SECTIONS,
	ENTRY,
	GOVERNING_SECTIONS,
	LANE_CHILD_SECTIONS,
	LOOP,
	PARK,
	PAUSE,
	PROGRESS: PROGRESS_WATCHER,
	RESUME,
	RETROSPECTIVE: RETROSPECTIVE_KEY,
}

export type { SectionReference }
export { run_step_section_table }
