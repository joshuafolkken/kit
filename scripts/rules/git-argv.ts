// The one reading of a shell segment as a `git` invocation, shared by the two Bash-string rows that
// judge a git command by its spelling (joshuafolkken/kit#2120): `git-force.ts` refuses a force push or
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

// The wrapper words that may stand in front of `git`, the same ones `run-tail.ts` skips in front of
// `josh`: environment assignments, the package-manager launchers, `sudo`, and an opening subshell
// parenthesis. Left in, `sudo git push --force` and `(git push -f)` are silently not a git command.
const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/u
const WRAPPER_WORDS: ReadonlySet<string> = new Set([
	'pnpm',
	'npx',
	'exec',
	'run',
	'sudo',
	'command',
])
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

// Split on whitespace alone. A refspec such as `:branch` and a short cluster such as `-uf` are single
// tokens with no inner spaces, and neither force detection nor stash detection needs to look inside a
// quoted argument — the one place a quote matters (a commit message) belongs to a subcommand neither
// caller judges.
const WHITESPACE = /\s+/u

function words_of(segment: string): Array<string> {
	return segment.split(WHITESPACE).filter((word) => word !== '')
}

function is_wrapper_token(word: string): boolean {
	return word === SUBSHELL_OPEN || ENV_ASSIGNMENT.test(word) || WRAPPER_WORDS.has(word)
}

// Skip the wrapper: environment assignments, a launcher word, and a leading subshell parenthesis. The
// first word that is none of these is where `git` has to be, or the segment is not a git command.
function after_wrapper(words: ReadonlyArray<string>): number {
	let index = 0

	while (index < words.length && is_wrapper_token(words[index] ?? '')) index += NEXT

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

// The subcommand and the arguments after it, or `undefined` when the segment is not a git invocation.
// **`pnpm josh git` is deliberately not one**: the word after the wrapper is `josh`, not `git`, so a
// run's own authorized `pnpm josh git -y` push is invisible here — which is exactly what keeps this row
// off the node route the deny list already leaves alone.
function parse(segment: string): GitCall | undefined {
	const words = words_of(segment)
	const git_index = after_wrapper(words)

	if (words[git_index] !== GIT_COMMAND) return undefined

	const subcommand_index = after_globals(words, git_index + NEXT)

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

const git_argv = { parse, short_cluster_has, words_of }

export { git_argv }
