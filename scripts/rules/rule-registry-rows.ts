// The `pnpm josh rule:guard` rows of the rule registry (`rule-registry.ts`), split out by size: the
// human-readable side of each `delivered-rules.ts` row, keyed by the row's `id`.

interface RegisteredRule {
	id: string
	title: string
	// The single source of the rule's procedure.
	topic: string
	// The hook command that delivers it.
	entry: string
	fires: string
	// The silent turn — it matches the state in which the rule is already kept.
	quiet: string
}

const RULE_GUARD = 'pnpm josh rule:guard'
const OPERATING_RULES = '`operating-rules.md`'
const PRE_GATE_CUT = '`.claude/skills/workflow-commands/pre-gate-cut.md`'
const SHELL_BODY = '`shell-body.md`'
const BACKGROUND_COMMANDS = '`.claude/skills/workflow-commands/background-commands.md`'
const BACKLOGRUN_LANES = '`.claude/skills/workflow-commands/backlogrun-lanes.md`'
const GIT_RULES = '`CLAUDE.md` → Git Rules'

const GUARD_ROWS: ReadonlyArray<RegisteredRule> = [
	{
		id: 'third-party-write',
		title: 'Third-party write',
		topic: '`upstream-interrupt.md`',
		entry: RULE_GUARD,
		fires:
			'a `gh api` write (field flag or a write method) to a repository whose owner is not this session. Every occurrence',
		quiet: 'a read, or a first-party owner (`pnpm josh repo:party`)',
	},
	{
		id: 'direct-filing',
		title: 'Direct filing',
		topic: '`docs/josh-commands-backlog.md` → `josh issue:file`',
		entry: RULE_GUARD,
		fires:
			'a `Bash` that creates an Issue outside `josh issue:file` (`gh issue create`, or a POST with `title` to `…/issues`); the refusal hands over the `pnpm josh issue:file` form. Every occurrence',
		quiet:
			'filing through `pnpm josh issue:file` — the duplicate scan, the body check and `epic:bundle` all run',
	},
	{
		id: 'filing-cap',
		title: 'The 10-Issue filing cap per run',
		topic: '`.claude/skills/workflow-commands/prerequisite.md`, `observation-filing.md`',
		entry: RULE_GUARD,
		fires:
			'the 11th `pnpm josh issue:file` in a run that already has 10 filings not refused; failed calls do not count. Every occurrence',
		quiet: 'fewer than 10 filings not refused',
	},
	{
		id: 'issue-comments',
		title: 'Reading Issue comments',
		topic: '`issue-comments.md`',
		entry: RULE_GUARD,
		fires:
			'a `Bash` that reads only the Issue body (`gh issue view <N>`, or a GET ending in `…/issues/<N>`). Refused until it is re-read with the comments',
		quiet:
			'no Issue read, or a read with `--comments` / `--json comments` / `…/comments` from the start',
	},
	{
		id: 'shell-body',
		title: 'No body on the shell',
		topic: SHELL_BODY,
		entry: RULE_GUARD,
		fires:
			'a double-quoted body value (`-f body="…"` / `-f "body=…"` / `--body "…"` / `--notify-message "…"`) carrying a backtick or `$`',
		quiet: 'the shell does not evaluate the body',
	},
	{
		id: 'raw-field-body',
		title: 'Posting `@path` literally',
		topic: SHELL_BODY,
		entry: RULE_GUARD,
		fires: 'a raw field (`-f` / `--raw-field`) passing `body=@<path>`. Every occurrence',
		quiet: '`-F` / `--field body=@`, a body without `@`, or `pnpm josh issue:comment`',
	},
	{
		id: 'piped-verification',
		title: 'Piped verification',
		topic: '`output-bounds.md`',
		entry: RULE_GUARD,
		fires:
			'a pass/fail josh check (`gate` / `check` / `lint*` / `cspell*` / `test*` / `eval` / `overrides` / `ranges`) in front of a pipe — rewritten under `set -o pipefail` when every filter is `tail` or a full-reading `grep`, refused otherwise',
		quiet: 'the exit code reaches the caller — a failure reads as a failure',
	},
	{
		id: 'early-heartbeat',
		title: 'Early progress report',
		topic:
			'`.claude/skills/workflow-commands/progress-watcher.md` → "Progress while the run is quiet"',
		entry: RULE_GUARD,
		fires:
			'a `Bash` whose only purpose is waiting (`sleep` alone, or `echo` / `:` / `date`) while a timer is live or before the interval. Every occurrence',
		quiet: 'no hand-made wait timer — `run:progress` holds the one clock',
	},
	{
		id: 'test-declared',
		title: 'Test declaration',
		topic: '`CLAUDE.md` → Code Change Rules',
		entry: RULE_GUARD,
		fires: '`pnpm josh git -y` (`josh g`) while `pnpm josh test:declared` answers `required`',
		quiet: '`exempt` (non-runtime only) or `satisfied` (tests included)',
	},
	{
		id: 'lane-background',
		title: 'Lane child background push',
		topic: BACKGROUND_COMMANDS,
		entry: RULE_GUARD,
		fires:
			'a dispatched lane child backgrounding `josh gate` / `git` / `followup` / `ship`; it hands over `pnpm josh ship --detach`. Every occurrence',
		quiet: 'not a lane child, or the foreground `ship --detach`',
	},
	{
		id: 'run-tail',
		title: 'Idle run tail',
		topic: BACKGROUND_COMMANDS,
		entry: RULE_GUARD,
		fires:
			'`pnpm josh git -y` (`josh g`, `--yes` alike) issued in the **foreground**. Every occurrence',
		quiet: 'issued in the background — its completion resumes the run',
	},
	{
		id: 'pre-gate-cut',
		title: 'The cut before the gate',
		topic: PRE_GATE_CUT,
		entry: RULE_GUARD,
		fires:
			'`pnpm josh gate` (`josh ga`) in a lane work tree whose `JOSH_LANE_CHILD` names the Issue and has no cut record',
		quiet: 'outside a lane, no marker (a person in the lane), or already cut',
	},
	{
		id: 'lane-split-park',
		title: 'A split is not a park',
		topic: '`.claude/skills/workflow-commands/backlogrun-park.md` → "Splitting a child mid-run"',
		entry: RULE_GUARD,
		fires:
			'a lane child that promoted its Issue to an epic this run parking it (`needs-decision`, `confirmation` notify). Every occurrence',
		quiet: 'no promotion this run',
	},
	{
		id: 'lane-park',
		title: 'Lane child park',
		topic: PRE_GATE_CUT,
		entry: RULE_GUARD,
		fires: 'a dispatched lane child issuing `pnpm josh notify --task-type confirmation`',
		quiet: 'not a lane child, or not a stop notification',
	},
	{
		id: 'lane-interactive-ask',
		title: 'Lane child interactive ask',
		topic: `${PRE_GATE_CUT} → "The interactive ask is refused one call earlier"`,
		entry: RULE_GUARD,
		fires:
			"a dispatched lane child's `AskUserQuestion`; it hands over the park procedure. Every occurrence",
		quiet: 'not a lane child, or not an interactive tool',
	},
	{
		id: 'lane-carry-conflict',
		title: 'Lane child carry commands',
		topic: BACKLOGRUN_LANES,
		entry: RULE_GUARD,
		fires: 'a dispatched lane child running `pnpm josh run:merge` / `run:carry`. Every occurrence',
		quiet: 'not a lane child — the parent owns the run budget',
	},
	{
		id: 'lane-switch-main',
		title: 'Lane child on `git switch main`',
		topic: BACKLOGRUN_LANES,
		entry: RULE_GUARD,
		fires:
			'a dispatched lane child switching to the default branch or running `josh main:sync`. Every occurrence',
		quiet: 'not a lane child — `pnpm josh main:merge` brings the default in at the gate',
	},
	{
		id: 'josh-git-bare',
		title: 'Bare `pnpm josh git`',
		topic: GIT_RULES,
		entry: RULE_GUARD,
		fires:
			'`pnpm josh git` without `-y`, whose staging prompt cancels with no TTY. Every occurrence',
		quiet: '`pnpm josh git -y`',
	},
	{
		id: 'git-force',
		title: 'Force push / branch delete',
		topic: OPERATING_RULES,
		entry: RULE_GUARD,
		fires:
			'a `git push` / `git branch` read as force (`--force` / `-f` / `-uf` …) or delete (`--delete` / `-d` / `-D` / `:branch`) in any spelling. Every occurrence',
		quiet: 'a plain `git push` / `git branch`',
	},
	{
		id: 'worktree-mutation',
		title: 'Unauthorized work-tree mutation',
		topic: OPERATING_RULES,
		entry: RULE_GUARD,
		fires:
			'`git checkout -- <path>` / `git restore <path>` / forced `git clean -f` / an unauthorized `git stash` (bare, push without a message, positional pop). Every occurrence',
		quiet: '`git stash push -m`, `git stash list`, `pnpm josh git`, `pnpm josh stash:pop`',
	},
	{
		id: 'file-body',
		title: 'No file body on the shell',
		topic: '`file-edits.md`',
		entry: RULE_GUARD,
		fires:
			'a heredoc write to an existing file, a writing `node -e` / interpreter heredoc, or `perl -0pi -e`. Every occurrence',
		quiet: 'a new file, a read-only heredoc, or a short `sed -i`',
	},
	{
		id: 'index-mutation',
		title: 'Index mutation',
		topic: OPERATING_RULES,
		entry: RULE_GUARD,
		fires:
			'`git add` / `commit` / `reset` / `rm` / `mv` / `restore --staged` in any spelling. Every occurrence',
		quiet: '`pnpm josh git` — the approved commit flow',
	},
	{
		id: 'destructive-command',
		title: 'Destructive command',
		topic: OPERATING_RULES,
		entry: RULE_GUARD,
		fires:
			'`rm -rf` (any spelling), `gh repo delete` / `archive`, `gh pr close`, `gh api -X DELETE`. Every occurrence',
		quiet: "`gh issue close` or removing an Issue label — the workflow's own steps",
	},
	{
		id: 'protected-file',
		title: 'Protected file',
		topic: OPERATING_RULES,
		entry: RULE_GUARD,
		fires:
			'a `Read` of `.env`, or an `Edit` / `Write` of `.claude/settings.json` outside kit. Every occurrence',
		quiet: "kit itself, or the user's `~/.claude/settings.json`",
	},
	{
		id: 'direct-pr-create',
		title: 'Direct PR creation',
		topic: GIT_RULES,
		entry: RULE_GUARD,
		fires:
			'`gh pr create`, or a `gh api` write to `repos/<o>/<r>/pulls`; it points at `pnpm josh pr`. Every occurrence',
		quiet: '`pnpm josh pr`, or reading a PR — the path that writes `closes #N`',
	},
	{
		id: 'poll-loop',
		title: 'Output poll loop',
		topic: BACKGROUND_COMMANDS,
		entry: RULE_GUARD,
		fires:
			"a hand-written `while` / `until` wait loop over a command's output, a marker file or a process. Every occurrence",
		quiet: 'the command started with `run_in_background` — its exit ends the wait',
	},
	{
		id: 'implementation-cut',
		title: 'The implementation-phase cut',
		topic: `${PRE_GATE_CUT} → "It is a guard, fired at the edit that crosses the threshold"`,
		entry: RULE_GUARD,
		fires:
			'an `Edit` / `Write` by an uncut lane child whose recent context is over the `pnpm josh cost --cut` threshold; it hands over `pnpm josh run:cut --impl <N> --handoff <path>`. At each threshold crossing',
		quiet: 'not a lane child, a non-editing tool, already cut, or under the threshold',
	},
	{
		id: 'rule-body',
		title: 'Question 0 and the ordering question before writing a rule into prose',
		topic: '`residency.md`',
		entry: RULE_GUARD,
		fires:
			'an `Edit` / `Write` to `CLAUDE.md` / `prompts/**/*.md` / `.claude/skills/**/*.md` appending at least the threshold. Refused until both `pnpm josh oracle:list` and `pnpm josh run:step` ran',
		quiet:
			'not a rule document, an append under the threshold (typo, link swap, deletion), or both commands ran',
	},
]

const rule_registry_rows = { GUARD_ROWS, RULE_GUARD }

export type { RegisteredRule }
export { rule_registry_rows }
