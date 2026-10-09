import type { DecisionOracle } from './decision-oracle'
import { oracle_tokens } from './decision-oracle-tokens'

// The batch oracles — the lane cut, the backlog budget and offer, the epic and post-merge steps, and
// `run:step` — kept beside the enumeration rather than inside it because `decision-oracle.ts` reached
// its file-size limit. They are one contiguous run of `DECISION_ORACLES`, so
// spreading them back in at the same position keeps the printed listing's order unchanged.

const {
	BUSY,
	EXCLUDE_ARG,
	HUMAN_REVIEW,
	ISSUE_N_ARG,
	NONE,
	NOT_A_LANE,
	OVER,
	RETRY,
	STOP,
	UNKNOWN,
	WAIT,
} = oracle_tokens

const PRE_GATE_CUT_MD = '.claude/skills/workflow-commands/pre-gate-cut.md'
const BACKLOGRUN_MD = '.claude/skills/workflow-commands/backlogrun.md'

// The command reference in `docs/josh-commands.md` — one section per command, headed by the command
// itself. `backlogrun.md` is a manifest of pointers, so a decision (`run:merge`, `epic:next`,
// `backlog:budget`, `run:liveness`, `auto-ok:next`) has its verdict contract only in this reference.
// That makes it the single source and the section a reader is routed to, in the same
// `file.md → \`josh <command>\`` form the `epic:reconcile` and `lane:list` entries use.
const RUN_MERGE_REFERENCE = 'docs/josh-commands-run.md → `josh run:merge`'
const EPIC_NEXT_REFERENCE = 'docs/josh-commands-backlog.md → `josh epic:next`'
const BACKLOG_BUDGET_REFERENCE = 'docs/josh-commands-backlog.md → `josh backlog:budget`'
const RUN_LIVENESS_REFERENCE = 'docs/josh-commands-run.md → `josh run:liveness`'
const AUTO_OK_NEXT_REFERENCE = 'docs/josh-commands-backlog.md → `josh auto-ok:next`'

// Command used by two separate oracle entries (run:cut:resume and run:cut:gate).
const RUN_CUT_CMD = 'run:cut'

const BATCH_ORACLES: ReadonlyArray<DecisionOracle> = [
	{
		name: 'run:cut:resume',
		command: RUN_CUT_CMD,
		decision: 'Whether a lane child is resuming prior work or starting fresh',
		args: `--resume ${ISSUE_N_ARG}`,
		vocabulary: ['fresh', 'resume', NOT_A_LANE],
		single_source: PRE_GATE_CUT_MD,
	},
	{
		name: 'run:cut:gate',
		command: RUN_CUT_CMD,
		decision: 'Whether a lane child should take its pre-gate cut now',
		args: ISSUE_N_ARG,
		vocabulary: ['cut', NOT_A_LANE],
		single_source: PRE_GATE_CUT_MD,
	},
	{
		name: 'backlog:budget',
		decision: 'Whether a backlogrun may start more work, keep watching, or finish',
		args: '',
		vocabulary: ['run', 'watch', STOP],
		single_source: BACKLOG_BUDGET_REFERENCE,
	},
	{
		name: 'run:liveness',
		decision: 'Whether a delegated unit is still working or has stopped without reporting',
		args: `${ISSUE_N_ARG} --output <path>`,
		vocabulary: ['alive', 'stopped', 'settled', 'undetermined'],
		single_source: RUN_LIVENESS_REFERENCE,
	},
	{
		name: 'stash:pop',
		decision: 'Whether a named stash entry exists and can be applied',
		args: '<message>',
		vocabulary: ['popped', 'conflicted', 'no-match', 'ambiguous'],
		single_source: '.claude/skills/workflow-commands/prerequisite.md',
	},
	{
		name: 'backlog:next',
		decision: 'Which issue the backlog offers next, or whether to wait or stop',
		args: EXCLUDE_ARG,
		vocabulary: [WAIT, STOP, RETRY, 'error', NONE],
		single_source: BACKLOGRUN_MD,
	},
	{
		name: 'auto-ok:next',
		decision: 'The next opted-in issue outside any epic, or none',
		args: EXCLUDE_ARG,
		vocabulary: [NONE],
		single_source: AUTO_OK_NEXT_REFERENCE,
	},
	{
		name: 'epic:next',
		decision: "The next runnable child of an epic, or the epic's status",
		args: '<epic>',
		vocabulary: [WAIT, STOP, 'complete'],
		single_source: EPIC_NEXT_REFERENCE,
	},
	{
		name: 'run:merge',
		decision: 'The post-merge batch step: confirm child, advance, or report a stop condition',
		args: ISSUE_N_ARG,
		vocabulary: [OVER, HUMAN_REVIEW, STOP, RETRY, BUSY],
		single_source: RUN_MERGE_REFERENCE,
	},
	{
		name: 'run:step',
		decision: 'The run’s next single action, computed from the event stream, carry and issue state',
		args: ISSUE_N_ARG,
		// The non-command answers: `run:step` prints a runnable command for a phase with one to run, and
		// one of these verdicts otherwise. A command line is not a vocabulary token, exactly as an issue
		// number is not one for `backlog:next`.
		vocabulary: [
			'implement',
			HUMAN_REVIEW,
			'update-deps',
			'already-done',
			'keep-work',
			WAIT,
			STOP,
			UNKNOWN,
		],
		single_source: BACKLOGRUN_MD,
	},
]

export { BATCH_ORACLES }
