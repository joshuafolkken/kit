import type { ShellShapeId } from './shell-shape-corpus-fixture'

// The shell shapes in `shell-shape-corpus-fixture.ts` each delivered rule's trigger fires on; it stays
// silent on every other shape. `shell-shape-corpus.test.ts` runs each rule on every shape, and refuses a
// rule left out here or one listed that is gone.

// The one row `oracle-consulted` builds per oracle that declares a firing point, named by its oracle.
const ORACLE_PKG_SCOUT = 'oracle-consulted:pkg:scout'

const HEREDOC: ShellShapeId = 'heredoc-mention'
const QUOTED: ShellShapeId = 'quoted-mention'
const SUBSHELL: ShellShapeId = 'subshell'
const SEMICOLON: ShellShapeId = 'semicolon-chain'
const TIME_FLAG_GATE: ShellShapeId = 'time-flag-gate'
const MULTILINE_FIELD: ShellShapeId = 'multiline-quoted-field'

// Filings, comments, bodies and oracle consultations.
const FILING_RULES: Record<string, ReadonlyArray<ShellShapeId>> = {
	'third-party-write': [MULTILINE_FIELD, HEREDOC],
	'direct-filing': [HEREDOC],
	'direct-issue-comment': [HEREDOC],
	'direct-issue-read': [HEREDOC],
	'issue-comments': [],
	'shell-body': [],
	'raw-field-body': [QUOTED, HEREDOC],
	'credential-body': [],
	'file-body': [],
	'rule-body': [],
	[ORACLE_PKG_SCOUT]: [HEREDOC],
}

// Git, PRs, verification runs and wrappers.
const GUARD_RULES: Record<string, ReadonlyArray<ShellShapeId>> = {
	'piped-verification': ['pipe'],
	'early-heartbeat': [],
	'test-declared': [HEREDOC],
	'run-tail': [HEREDOC],
	'timed-rerun': ['hyperfine-quoted', 'time-flag-value', TIME_FLAG_GATE, HEREDOC],
	'josh-git-bare': ['and-chain', HEREDOC],
	'git-force': [MULTILINE_FIELD, HEREDOC],
	'worktree-mutation': [SUBSHELL, HEREDOC],
	'index-mutation': ['and-chain', HEREDOC],
	'destructive-command': [SUBSHELL, HEREDOC],
	'repo-admin': [],
	'protected-file': [HEREDOC],
	'direct-pr-create': [SEMICOLON, HEREDOC],
	'pr-merge': [SEMICOLON, HEREDOC],
	'poll-loop': [],
}

// The lane-scoped rules — read in the dispatched lane child the test pins, so each rule reaches its
// command test.
const LANE_RULES: Record<string, ReadonlyArray<ShellShapeId>> = {
	'lane-background': [HEREDOC],
	'pre-gate-cut': [
		'plain',
		TIME_FLAG_GATE,
		'env-timeout-gate',
		'gate-substitution',
		'pipe',
		HEREDOC,
	],
	'lane-split-park': [],
	'lane-park': ['command-substitution', HEREDOC],
	'lane-interactive-ask': [],
	'agent-model': [],
	'investigator-foreground': [],
	'lane-carry-conflict': [HEREDOC],
	'lane-switch-main': [SUBSHELL, HEREDOC],
	// The corpus heredoc is `cat`'s, which runs nothing; a shell's heredoc is pinned in its own test.
	'lane-direct-tool': [],
	'implementation-cut': [],
}

const shell_shape_rules_fixture = { FILING_RULES, GUARD_RULES, LANE_RULES }

export { shell_shape_rules_fixture }
