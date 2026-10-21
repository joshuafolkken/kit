// The one reading of a shell segment as a `git` invocation, shared by the two Bash-string rows that
// judge a git command by its spelling: `git-force.ts` refuses a force push or
// a branch delete, and `worktree-guard.ts` refuses an unauthorized working-tree change. Both have to
// skip the same wrapper and the same git global options before the subcommand is even in hand, so the
// cut lives here rather than beside whichever row needed it first — two copies of it would be the clone
// `CLAUDE.md` prohibits, and the copy that forgot `git -C <path>` would be the one that stopped seeing
// the spelling the deny list already cannot express.
//
// **The deny list matches globs; this reads argv.** `Bash(git push *--force*)` cannot see a combined
// short cluster (`git push -uf`), a `-C <path>` prefix, or the colon-form delete (`git push origin
// :branch`), because none of those put the literal the glob keys on where the glob looks. Parsing the
// arguments is what makes the judgement independent of the spelling.

// The wrapper words that may stand in front of `git`, the same ones `run-tail-rule.ts` skips in front of
// `josh`: environment assignments, the package-manager launchers, `sudo`, `env`, and an opening
// subshell parenthesis — plus `time` with its flags, read here only. Left in, `sudo git push --force`,
// `env git commit` and `(git push -f)` are silently not a git command, and
// `/usr/bin/time -p pnpm exec eslint .` is not an `eslint` run (joshuafolkken/kit#4356).
const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/u
const WRAPPER_WORDS: ReadonlySet<string> = new Set([
	'pnpm',
	'npx',
	'exec',
	'run',
	'sudo',
	'command',
	'env',
	'time',
])
// The wrappers whose own flags stand between them and the program (`time -p`), skipped with them.
const FLAGGED_WRAPPERS: ReadonlySet<string> = new Set(['time'])
// Their flags that consume a separate following value (`time -o <file>`, `time -f <format>`), so the
// value is not read as the program.
const WRAPPER_VALUE_FLAGS: ReadonlySet<string> = new Set(['-o', '-f', '--output', '--format'])
const SUBSHELL_OPEN = '('

// The git global options that consume a **separate** following token as their value, so the parser
// skips two words rather than one. `--opt=value` carries its value inline and is skipped as one word by
// the ordinary flag branch below.
const VALUE_TAKING_GLOBALS: ReadonlySet<string> = new Set([
	'-C',
	'-c',
	'--git-dir',
	'--work-tree',
	'--namespace',
	'--exec-path',
	'--super-prefix',
])

const FLAG_PREFIX = '-'
const GIT_COMMAND = 'git'
const NEXT = 1
const AFTER_VALUE = 2

interface GitCall {
	subcommand: string | undefined
	args: ReadonlyArray<string>
}

// Split on whitespace outside quotes, keeping each quote in its word. A quoted span is one word, so
// `c='x; gh pr create'` is one environment assignment rather than an assignment followed by a `gh`
// call (joshuafolkken/kit#4091); a backslash-escaped character outside quotes opens no span, and a
// quote left unclosed is read as a plain character.
const WORD = /(?:\\.|'[^']*'|"(?:\\.|[^"\\])*"|\S)+/gsu

function words_of(segment: string): Array<string> {
	return segment.match(WORD) ?? []
}

const PATH_SEPARATOR = '/'

// The program a word launches, read off the path's last component, so `/usr/bin/git` is `git`.
function program_name(word: string): string {
	return word.slice(word.lastIndexOf(PATH_SEPARATOR) + NEXT)
}

function is_wrapper_token(word: string): boolean {
	return (
		word === SUBSHELL_OPEN || ENV_ASSIGNMENT.test(word) || WRAPPER_WORDS.has(program_name(word))
	)
}

// The words a flagged wrapper's flag spans, its value included; 0 when the word is not a flag.
function wrapper_flag_width(word = ''): number {
	if (!word.startsWith(FLAG_PREFIX)) return 0

	return WRAPPER_VALUE_FLAGS.has(word) ? AFTER_VALUE : NEXT
}

// The index after the wrapper word at `index`, past its own flags when it is a flagged wrapper.
function after_wrapper_word(words: ReadonlyArray<string>, index: number): number {
	let next = index + NEXT

	if (!FLAGGED_WRAPPERS.has(program_name(words[index] ?? ''))) return next

	let width = wrapper_flag_width(words[next])

	while (width > 0) {
		next += width
		width = wrapper_flag_width(words[next])
	}

	return next
}

// Skip the wrapper: environment assignments, a launcher word, and a leading subshell parenthesis. The
// first word that is none of these is where `git` has to be, or the segment is not a git command.
function after_wrapper(words: ReadonlyArray<string>): number {
	let index = 0

	while (index < words.length && is_wrapper_token(words[index] ?? '')) {
		index = after_wrapper_word(words, index)
	}

	return index
}

// A value-taking global with no `=` swallows the next word too; every other flag is one word.
function global_step(flag: string): number {
	return VALUE_TAKING_GLOBALS.has(flag) ? AFTER_VALUE : NEXT
}

// Skip git's own global options, so `git -C <path> -c user.name=x push` reaches `push`.
function after_globals(words: ReadonlyArray<string>, start: number): number {
	let index = start

	while (index < words.length) {
		const flag = words[index] ?? ''

		if (!flag.startsWith(FLAG_PREFIX)) return index

		index += global_step(flag)
	}

	return index
}

interface ProgramCall {
	name: string
	args: Array<string>
}

// The program the segment launches once the wrapper is skipped, with the words after it, or
// `undefined` for a segment with no program word.
function program_of(segment: string): ProgramCall | undefined {
	const words = words_of(segment)
	const command_index = after_wrapper(words)
	const word = words[command_index]

	if (word === undefined) return undefined

	return { name: program_name(word), args: words.slice(command_index + NEXT) }
}

// The words after `command` once the wrapper is skipped, or `undefined` when the segment does not
// invoke it. `gh` and `rm` are judged by the same wrapper cut as `git`, so
// `env gh pr close` and `sudo rm -rf` are read as the calls they are.
function arguments_of(segment: string, command: string): Array<string> | undefined {
	const call = program_of(segment)

	return call?.name === command ? call.args : undefined
}

// The subcommand and the arguments after it, or `undefined` when the segment is not a git invocation.
// **`pnpm josh git` is deliberately not one**: the word after the wrapper is `josh`, not `git`, so a
// run's own authorized `pnpm josh git -y` push is invisible here — which is exactly what keeps this row
// off the node route the deny list already leaves alone.
function parse(segment: string): GitCall | undefined {
	const words = arguments_of(segment, GIT_COMMAND)

	if (words === undefined) return undefined

	const subcommand_index = after_globals(words, 0)

	return { subcommand: words[subcommand_index], args: words.slice(subcommand_index + NEXT) }
}

// A single-dash cluster of letters (`-uf`, `-D`), never a `--long` flag. The callers ask whether such a
// cluster carries a given letter — `f` for a force push, `d` for a delete — because the deny list's
// glob cannot see a letter bundled with others.
const SHORT_CLUSTER = /^-[A-Za-z]+$/u

function short_cluster_has(token: string, letters: string): boolean {
	if (!SHORT_CLUSTER.test(token)) return false

	const cluster = token.slice(FLAG_PREFIX.length)

	for (let index = 0; index < letters.length; index += 1) {
		if (cluster.includes(letters.charAt(index))) return true
	}

	return false
}

const git_argv = { arguments_of, parse, program_of, short_cluster_has }

export { git_argv }
