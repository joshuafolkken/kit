// The enumeration of decision oracles — commands that answer a rule question from mechanically
// readable inputs, making prose reasoning unnecessary.
//
// **Question 0 of the rule-placement criterion**: "Can the rule's answer be computed from
// mechanically readable inputs alone?" A yes means the rule is answered by a command on this list,
// not by prose. Single source: `prompts/collaboration-workflow/residency.md` → question 0.
//
// Anything not on this list is answered by prose or by a hook-delivered rule, never by a command.
import { BATCH_ORACLES } from './decision-oracle-batch'
import { RUN_ENTRY_ORACLE } from './decision-oracle-stage'
import { oracle_tokens } from './decision-oracle-tokens'

const { BUSY, ISSUE_N_ARG, NONE, OVER, REQUIRED, SKIP, UNKNOWN } = oracle_tokens

// Paths that appear in more than one entry's `single_source` field.
const CHAIN_RULE_MD = '.claude/skills/workflow-commands/chain-rule.md'
const BACKLOGRUN_PROGRESS_MD = '.claude/skills/workflow-commands/backlogrun-progress.md'
const SKILL_2E = '.claude/skills/workflow-commands/issue-scout.md'
const SPLIT_ASSESSMENT_QUESTION =
	'.claude/skills/workflow-commands/split-assessment.md → The question'

// Lane liveness verdicts shared by the lane:list oracle and asserted against `lane_occupancy` in its
// test. `LIVE` is the silent norm; `STOPPED` and `UNKNOWN` lead the difference lines.
const LIVE = 'live'
const STOPPED = 'stopped'
// The verdicts `epic --reconcile` prints; kept in step with the `epic_reconcile` constants in its
// test.
const RECONCILED = 'reconciled'
const NOTHING_TO_RECONCILE = 'nothing to reconcile'

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
		single_source: '.claude/skills/workflow-commands/delegation.md',
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
		single_source: '.claude/skills/workflow-commands/working-tree-hold.md',
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
		single_source: '.claude/skills/workflow-commands/followup.md',
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
		vocabulary: ['fold', 'separate', 'no-fold-needed', 'undetermined'],
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
			'Each boundary a change crosses (network, process, fs, time) and the abnormal cases it owes',
		args: '<path...>',
		vocabulary: ['network', 'process', 'fs', 'time', NONE],
		single_source: 'prompts/collaboration-workflow/report-format.md → 変更とテスト',
	},
	{
		name: 'issue:state',
		decision: "An issue's state, labels, and human-review flag",
		args: ISSUE_N_ARG,
		vocabulary: ['human_review: yes', 'human_review: no'],
		single_source: '.claude/skills/workflow-commands/needs-human-review.md',
	},
	...BATCH_ORACLES,
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
		single_source: 'prompts/collaboration-workflow/principles.md → no-clones',
	},
	{
		name: 'epic:reconcile',
		command: 'epic',
		decision:
			"Whether an epic's declaration matches its recorded relations, and the repair when it does not",
		args: '--reconcile <E>',
		vocabulary: [RECONCILED, NOTHING_TO_RECONCILE],
		single_source: 'docs/josh-commands-backlog.md → `josh epic --reconcile`',
	},
	{
		name: 'lane:list',
		decision:
			'Whether each in-progress issue holds a live lane, and the two-directional difference',
		args: '',
		vocabulary: [LIVE, STOPPED, UNKNOWN],
		single_source: 'docs/josh-commands-run.md → The `in-progress` / lane difference',
	},
	RUN_ENTRY_ORACLE,
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

export type { DecisionOracle }
export { decision_oracle }
