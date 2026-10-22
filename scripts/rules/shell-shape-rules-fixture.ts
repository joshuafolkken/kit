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

// Filings, comments, bodies and oracle consultations.
const FILING_RULES: Record<string, ReadonlyArray<ShellShapeId>> = {
	'third-party-write': [HEREDOC],
	'direct-filing': [QUOTED, HEREDOC],
	'direct-issue-comment': [HEREDOC],
	'filing-cap': [HEREDOC],
	'issue-comments': [],
	'shell-body': [],
	'raw-field-body': [QUOTED, HEREDOC],
	'file-body': [],
	'rule-body': [],
	[ORACLE_PKG_SCOUT]: [HEREDOC],
}

// Git, PRs, verification runs and wrappers.
const GUARD_RULES: Record<string, ReadonlyArray<ShellShapeId>> = {
	'piped-verification': ['pipe'],
	'early-heartbeat': [],
	'test-declared': [],
	'run-tail': [HEREDOC],
	'timed-rerun': ['hyperfine-quoted', 'time-flag-value', HEREDOC],
	'josh-git-bare': ['and-chain', HEREDOC],
	'git-force': ['multiline-quoted-field', HEREDOC],
	'worktree-mutation': [SUBSHELL, HEREDOC],
	'index-mutation': ['and-chain', HEREDOC],
	'destructive-command': [SUBSHELL, HEREDOC],
	'protected-file': [HEREDOC],
	'direct-pr-create': [SEMICOLON, HEREDOC],
	'pr-merge': [SEMICOLON, HEREDOC],
	'poll-loop': [],
}

// The lane-scoped rules — read in the dispatched lane child the test pins, so each rule reaches its
// command test.
const LANE_RULES: Record<string, ReadonlyArray<ShellShapeId>> = {
	'lane-background': [HEREDOC],
	'pre-gate-cut': ['plain', 'pipe', HEREDOC],
	'lane-split-park': [],
	'lane-park': ['command-substitution', HEREDOC],
	'lane-interactive-ask': [],
	'agent-model': [],
	'lane-carry-conflict': [HEREDOC],
	'lane-switch-main': [SUBSHELL, HEREDOC],
	'lane-direct-tool': [HEREDOC],
	'implementation-cut': [],
}

const shell_shape_rules_fixture = { FILING_RULES, GUARD_RULES, LANE_RULES }

export { shell_shape_rules_fixture }
