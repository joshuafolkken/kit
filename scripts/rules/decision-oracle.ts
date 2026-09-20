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
const PRE_GATE_CUT_MD = '.claude/skills/workflow-commands/pre-gate-cut.md'
const BACKLOGRUN_MD = '.claude/skills/workflow-commands/backlogrun.md'

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
	// The fixed-vocabulary tokens the command prints on stdout. An issue number is not a
	// vocabulary token; only the named string verdicts appear here.
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
		name: 'issue:lint',
		decision:
			'Whether a behavior-change issue declares a deliverable firing point and a re-runnable baseline',
		args: '<path>',
		vocabulary: ['ok', '✖ missing heading', '✖ firing point', '✖ baseline'],
		single_source: 'prompts/collaboration-workflow/issue-template.md',
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
		single_source: BACKLOGRUN_PROGRESS_MD,
	},
	{
		name: 'run:liveness',
		decision: 'Whether a delegated unit is still working or has stopped without reporting',
		args: `${ISSUE_N_ARG} --output <path>`,
		vocabulary: ['alive', 'stopped', 'settled', 'undetermined'],
		single_source: BACKLOGRUN_MD,
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
		single_source: BACKLOGRUN_MD,
	},
	{
		name: 'epic:next',
		decision: "The next runnable child of an epic, or the epic's status",
		args: '<epic>',
		vocabulary: [WAIT, STOP, 'complete'],
		single_source: BACKLOGRUN_MD,
	},
	{
		name: 'run:merge',
		decision: 'The post-merge batch step: confirm child, advance, or report a stop condition',
		args: ISSUE_N_ARG,
		vocabulary: [OVER, 'human-review', STOP, RETRY, BUSY],
		single_source: BACKLOGRUN_MD,
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
