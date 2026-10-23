// The shell shapes every command-text rule is run against (joshuafolkken/kit#4517). Each shape here
// was first found by one rule's review — a multi-line quote, a heredoc, a substitution, a wrapper and
// its flag value, a mention inside quotes — and is listed once so every other rule has to say what it
// does with it. `shell-shape-corpus.test.ts` runs every rule on a shape added here and refuses one that
// fires where `shell-shape-rules-fixture.ts` does not list it, and refuses a reader in
// `shell-shape-readers-fixture.ts` that leaves the shape undeclared.

// One plain trigger for each rule whose trigger needs no body, loop, issue URL or tree state, so each
// has its own trigger to find, or to ignore, inside the mention shapes below.
const GATE = 'pnpm josh gate'
const MENTIONED = [
	'gh issue create --title x',
	'gh issue comment 5 --body x',
	'gh issue view 5',
	'gh pr create --title x',
	'gh pr merge 5',
	'gh api repos/other/repo/issues/1/comments -f body=x',
	'gh api repos/joshuafolkken/kit/issues/1/comments -f body=@b.md',
	'pnpm josh issue:file x --body-file b.md',
	'pnpm josh git',
	'pnpm josh git -y',
	GATE,
	'pnpm josh run:merge',
	'pnpm josh notify --task-type confirmation',
	'pnpm add lodash',
	'git push --force',
	'git add -A',
	'git restore foo.ts',
	'git switch main',
	'rm -rf /tmp/x',
	'cat .env',
	'eslint .',
	'time pnpm josh gate',
]

const SHELL_SHAPES = {
	// A plain command with no shape around it — the baseline every other row is read against.
	plain: GATE,
	// `-f query='…'` spanning lines, its body naming a mutation and a line that reads as a command
	// (#4038).
	'multiline-quoted-field':
		'gh api graphql -f query=\'mutation {\n  addComment(input: {subjectId: "x", body: "y"}) {\n    clientMutationId\n  }\n}\ngit push --force\'',
	// `curl -d@file` — the body is a file, glued to its flag (#4038).
	'curl-data-file':
		'curl -X POST -d@body.json https://api.github.com/repos/joshuafolkken/kit/issues',
	// `ssh` / `eval` and every trigger above named only inside a double-quoted argument (#4091).
	'quoted-mention': String.raw`echo "ssh host, eval \"$x\", ${MENTIONED.join(', ')}"`,
	// The commands a benchmark wrapper runs, quoted (#4221, #4356).
	'hyperfine-quoted': 'hyperfine --runs 3 "pnpm josh gate" "eslint ."',
	// `time` with a valued flag, whose value is not the command (#4356).
	'time-flag-value': '/usr/bin/time -f %e pnpm josh git -y',
	// An environment prefix and `timeout` with its duration.
	'env-timeout-wrapper': 'CI=1 timeout 600 git push --force origin HEAD',
	// The same two wrappers around the gate itself (#4525).
	'time-flag-gate': '/usr/bin/time -f %e pnpm josh gate',
	'env-timeout-gate': 'CI=1 timeout 600 pnpm josh gate',
	// `$(…)` around the command (#4418).
	'command-substitution': 'out="$(pnpm josh notify --task-type confirmation)"; echo "$out"',
	// `$(…)` around the gate (#4525).
	'gate-substitution': 'out="$(pnpm josh gate)"',
	// `;` between commands (#4418).
	'semicolon-chain': 'git status; gh pr create --title "x" --body-file body.md; gh pr merge 5',
	// `&&` between commands.
	'and-chain': 'git add -A && git commit -m "x" && pnpm josh git',
	// `|` into a filter.
	pipe: 'pnpm josh gate | tail -20',
	// `( … )` around a chain.
	subshell: '(cd scripts && git restore foo.ts && rm -rf /tmp/x && git switch main)',
	// Every trigger above named only in a heredoc's body, one per line (#4418).
	'heredoc-mention': `cat <<'EOF' > notes.md\n${MENTIONED.join('\n')}\nEOF`,
	// A name that only begins with a command's name (#4157, #4246).
	'name-prefix':
		'pnpm josh gate:stats && gh issue created-list && pnpm josh run:merge-state && eslintrc',
} as const

type ShellShapeId = keyof typeof SHELL_SHAPES

// What one reader answers for every shape, keyed so a missing row is a type error as well as a red
// test.
type ShapeExpectations<T> = Record<ShellShapeId, T>

const shell_shape_corpus_fixture = { SHELL_SHAPES }

export { shell_shape_corpus_fixture }
export type { ShapeExpectations, ShellShapeId }
