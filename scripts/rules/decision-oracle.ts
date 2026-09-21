// The enumeration of decision oracles — commands that answer a rule question from mechanically
// readable inputs, making prose reasoning unnecessary (joshuafolkken/kit#2117).
//
// **Question 0 of the rule-placement criterion**: "Can the rule's answer be computed from
// mechanically readable inputs alone?" A yes means the rule is answered by a command on this list,
// not by prose. Single source: `prompts/collaboration-workflow/residency.md` → question 0.
//
// Anything not on this list is answered by prose or by a hook-delivered rule, never by a command.

// Paths that appear in more than one entry's `single_source` field.
const CHAIN_RULE_MD = '.claude/skills/workflow-commands/chain-rule.md'
const BACKLOGRUN_PROGRESS_MD = '.claude/skills/workflow-commands/backlogrun-progress.md'
const SKILL_2E = '.claude/skills/workflow-commands/SKILL.md → §2e'
const SPLIT_ASSESSMENT_QUESTION =
	'.claude/skills/workflow-commands/split-assessment.md → The question'
const PRE_GATE_CUT_MD = '.claude/skills/workflow-commands/pre-gate-cut.md'
const BACKLOGRUN_MD = '.claude/skills/workflow-commands/backlogrun.md'

// The command reference in `docs/josh-commands.md` — one section per command, headed by the command
// itself. joshuafolkken/kit#2190 cut `backlogrun.md` back to a manifest of pointers, so a decision it
// used to carry inline (`run:merge`, `epic:next`, `backlog:budget`, `run:liveness`, `auto-ok:next`)
// now has its verdict contract only in this reference. That makes it the single source and the section
// a reader is routed to, in the same `file.md → \`josh <command>\`` form the `epic:reconcile` and
// `lane:list` entries already use. joshuafolkken/kit#2254.
const RUN_MERGE_REFERENCE = 'docs/josh-commands.md → `josh run:merge`'
const EPIC_NEXT_REFERENCE = 'docs/josh-commands.md → `josh epic:next`'
const BACKLOG_BUDGET_REFERENCE = 'docs/josh-commands.md → `josh backlog:budget`'
const RUN_LIVENESS_REFERENCE = 'docs/josh-commands.md → `josh run:liveness`'
const AUTO_OK_NEXT_REFERENCE = 'docs/josh-commands.md → `josh auto-ok:next`'

// Command used by two separate oracle entries (run:cut:resume and run:cut:gate).
const RUN_CUT_CMD = 'run:cut'

// Vocabulary tokens that appear in more than one oracle's vocabulary array.
const REQUIRED = 'required'
const SKIP = 'skip'
const STOP = 'stop'
const WAIT = 'wait'
const RETRY = 'retry'
const OVER = 'over'
const UNKNOWN = 'unknown'
const NONE = 'none'
const NOT_A_LANE = 'not-a-lane'
const BUSY = 'busy'
const HUMAN_REVIEW = 'human-review'
// Lane liveness verdicts shared by the lane:list oracle and asserted against `lane_occupancy` in its
// test. `LIVE` is the silent norm; `STOPPED` and `UNKNOWN` lead the difference lines.
const LIVE = 'live'
const STOPPED = 'stopped'
// The verdicts `epic --reconcile` prints; kept in step with the `git_epic_reconcile` constants in its
// test.
const RECONCILED = 'reconciled'
const NOTHING_TO_RECONCILE = 'nothing to reconcile'

// Arguments shared by more than one oracle entry.
const ISSUE_N_ARG = '<N>'
const EXCLUDE_ARG = '[--exclude <n>...]'

interface DecisionOracle {
	// Short identifier used by the CLI and tests.
	name: string
	// The rule question the command answers.
	decision: string
	// The command subcommand (without the `pnpm josh` prefix). Omit when equal to `name`;
	// `get_command()` returns the effective value.
	command?: string
	// The arguments to pass, shown in the printed listing.
	args: string
	// The fixed-vocabulary tokens the command emits — on standard output for a pure decision command,
	// or on the difference lines of a listing command (`lane:list`) whose standard output is reserved
	// for its listing. An issue number is not a vocabulary token; only the named string verdicts appear
	// here, and each is kept in step with the constant its emitting module exports.
	vocabulary: ReadonlyArray<string>
	// The single-source document for the decision procedure, in `file.md → section` form.
	single_source: string
}

const DECISION_ORACLES: ReadonlyArray<DecisionOracle> = [
	{
		name: 'delegate',
		decision: 'Whether a run step may be delegated to a cheaper execution tier',
		args: '<step>',
		vocabulary: ['delegate', 'keep'],
		single_source: '.claude/skills/workflow-commands/SKILL.md → §2b',
	},
	{
		name: 'review:level',
		decision: 'The code-review level for the changed paths',
		command: 'review:brief',
		args: '--level-only',
		vocabulary: ['low', 'medium', 'high', 'max'],
		single_source: 'prompts/review.md',
	},
	{
		name: 'review:round2',
		decision: 'Whether the second /code-review round is due',
		args: '[--round-1-closed]',
		vocabulary: [REQUIRED, SKIP],
		single_source: CHAIN_RULE_MD,
	},
	{
		name: 'disposition',
		decision: 'Whether a review finding reaches a runtime path, so it may be filed',
		args: '<path...>',
		vocabulary: ['runtime', 'non-runtime'],
		single_source: 'prompts/review.md → Three-way disposition after the cap',
	},
	{
		name: 'review:attest',
		decision: 'Whether a /code-review attested the briefed checkout',
		args: '--check',
		vocabulary: ['ok', 'missing', 'mismatch', 'not-required'],
		single_source: CHAIN_RULE_MD,
	},
	{
		name: 'latest:scope',
		decision: 'Whether this run has to update dependencies first',
		args: '',
		vocabulary: [REQUIRED, SKIP],
		single_source: '.claude/skills/workflow-commands/latest-gate.md',
	},
	{
		name: 'run:hold',
		decision: 'Whether this working tree is free for a run to claim',
		args: `[${ISSUE_N_ARG}]`,
		vocabulary: ['hold', BUSY, UNKNOWN],
		single_source: '.claude/skills/workflow-commands/SKILL.md → §2f',
	},
	{
		name: 'cost:cut',
		command: 'cost',
		decision: 'Whether the session cost exceeds the hand-off threshold',
		args: '--cut',
		vocabulary: [OVER, 'under'],
		single_source: BACKLOGRUN_PROGRESS_MD,
	},
	{
		name: 'release:scope',
		decision: 'Whether a release is owed after this merge',
		args: '',
		vocabulary: [REQUIRED, SKIP, UNKNOWN],
		single_source: '.claude/skills/workflow-commands/followup-reference.md',
	},
	{
		name: 'epic:bundle',
		decision: 'Which epic a newly filed issue belongs to',
		args: ISSUE_N_ARG,
		vocabulary: ['add_to_epic', 'create_epic', 'ask', 'nothing_to_bundle'],
		single_source: SKILL_2E,
	},
	{
		name: 'issue:scout',
		decision: 'Whether a matching open issue already exists before filing',
		args: '<title>',
		vocabulary: ['Duplicates:', 'Epic:'],
		single_source: SKILL_2E,
	},
	{
		name: 'issue:fold',
		decision: 'Whether findings filed from one session fold into one issue or stay separate',
		args: '<title...>',
		vocabulary: ['fold', 'separate', 'no-fold-needed'],
		single_source: SPLIT_ASSESSMENT_QUESTION,
	},
	{
		name: 'pkg:scout',
		decision: 'Whether the top package candidate is clearly best (Tier A) or a near-tie (Tier B)',
		args: '<keywords>',
		vocabulary: ['clear', 'close'],
		single_source: 'CLAUDE.md → Package-First Development',
	},
	{
		name: 'issue:lint',
		decision:
			'Whether a behavior-change issue declares a deliverable firing point and a re-runnable baseline',
		args: '<path>',
		vocabulary: ['ok', '✖ missing heading', '✖ firing point', '✖ baseline'],
		single_source: 'prompts/collaboration-workflow/issue-template.md',
	},
	{
		name: 'cases',
		decision:
			'Each I/O boundary a change crosses (network, process, fs) and the abnormal cases it owes',
		args: '<path...>',
		vocabulary: ['network', 'process', 'fs', NONE],
		single_source: 'prompts/collaboration-workflow/report-format.md → 変更とテスト',
	},
	{
		name: 'issue:state',
		decision: "An issue's state, labels, and human-review flag",
		args: ISSUE_N_ARG,
		vocabulary: ['human_review: yes', 'human_review: no'],
		single_source: '.claude/skills/workflow-commands/SKILL.md → §2z',
	},
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
		single_source: '.claude/skills/workflow-commands/SKILL.md → §2d',
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
		vocabulary: ['implement', HUMAN_REVIEW, 'update-deps', 'already-done', WAIT, STOP, UNKNOWN],
		single_source: BACKLOGRUN_MD,
	},
	{
		name: 'refactor:scan',
		decision: 'Whether the refactoring scope still holds high- or medium-priority candidates',
		args: '',
		vocabulary: ['clear', 'candidates', 'error'],
		single_source: 'prompts/refactoring.md',
	},
	{
		name: 'split:assess',
		decision: 'Whether a change size clears the split guide (the split assessment size question)',
		args: '[--json]',
		vocabulary: ['split', 'single'],
		single_source: SPLIT_ASSESSMENT_QUESTION,
	},
	{
		name: 'sonar:hotspots',
		decision: 'The Step B disposition for each SonarCloud hotspot on a pull request',
		args: '<PR>',
		vocabulary: ['excluded', 'local', 'fix', 'defer', 'unreadable'],
		single_source: 'prompts/sonar-hotspot-handling.md',
	},
	{
		name: 'clone:scan',
		decision: 'Whether cross-file or cross-repository code duplication exists',
		args: '',
		vocabulary: ['clean', 'clones:'],
		single_source: 'prompts/collaboration-workflow/no-clones.md',
	},
	{
		name: 'epic:reconcile',
		command: 'epic',
		decision:
			"Whether an epic's declaration matches its recorded relations, and the repair when it does not",
		args: '--reconcile <E>',
		vocabulary: [RECONCILED, NOTHING_TO_RECONCILE],
		single_source: 'docs/josh-commands.md → `josh epic --reconcile`',
	},
	{
		name: 'lane:list',
		decision:
			'Whether each in-progress issue holds a live lane, and the two-directional difference',
		args: '',
		vocabulary: [LIVE, STOPPED, UNKNOWN],
		single_source: 'docs/josh-commands.md → The `in-progress` / lane difference',
	},
]

// Returns the command name for an oracle entry. When `command` is omitted from the entry,
// the `name` field doubles as the command name.
function get_command(oracle: DecisionOracle): string {
	return oracle.command ?? oracle.name
}

function find_oracle(name: string): DecisionOracle | undefined {
	return DECISION_ORACLES.find((oracle) => oracle.name === name.trim())
}

const decision_oracle = {
	DECISION_ORACLES,
	find_oracle,
	get_command,
}

export { decision_oracle }
