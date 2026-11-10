// **`josh lint --shard=<n>` lints one of two fixed halves of the tree** (joshuafolkken/kit#6997). A change
// to a module in the `scripts/` import cycle drops 1,580 to 2,400 eslint cache entries
// (`eslint-cache-dependencies.ts`), and CI's whole-tree lint re-lints every one of them on one runner —
// about 220 s. Two runners, each with one shard, share that work.
//
// The halves are drawn by directory, never by file list, so eslint still resolves every target
// itself: shard 1 names the directories below, and shard 2 is `.` with those same directories ignored.
// Together they lint exactly what `eslint .` lints, whatever the config's `files` and `ignores` say.
// The directories are this repository's: the ones holding about half of the entries such a change
// drops (`scripts/lib/poll.ts` 1,105 of 2,420; `run-ship-preflight.ts` 849 of 1,583).
//
// Prettier is not sharded — it is fast on its cache — so shard 1 checks the whole tree's formatting
// and shard 2 checks none.
const SHARD_FLAG_PREFIX = '--shard='
const FIRST_SHARD = 1
const SECOND_SHARD = 2
const WHOLE_TREE = '.'
const IGNORE_PATTERN_FLAG = '--ignore-pattern'
const FORMATTING_SHARD_REASON = `shard ${String(FIRST_SHARD)} checks the whole tree's formatting`
const FIRST_SHARD_DIRECTORIES: ReadonlyArray<string> = [
	'scripts/run',
	'scripts/issue',
	'scripts/epic',
	'scripts/review',
]

type LintShard = typeof FIRST_SHARD | typeof SECOND_SHARD

function parse_shard(value: string): LintShard {
	const shard = Number(value)

	if (shard === FIRST_SHARD || shard === SECOND_SHARD) return shard

	throw new Error(
		`josh lint: unknown shard "${value}" — use --shard=${String(FIRST_SHARD)} or --shard=${String(SECOND_SHARD)}`,
	)
}

// The shard the arguments name, or `undefined` when they name none — the whole tree.
function shard_of(arguments_: ReadonlyArray<string>): LintShard | undefined {
	const flag = arguments_.find((argument) => argument.startsWith(SHARD_FLAG_PREFIX))

	return flag === undefined ? undefined : parse_shard(flag.slice(SHARD_FLAG_PREFIX.length))
}

function second_shard_targets(): Array<string> {
	return [
		WHOLE_TREE,
		...FIRST_SHARD_DIRECTORIES.flatMap((directory) => [IGNORE_PATTERN_FLAG, `${directory}/`]),
	]
}

// What eslint is pointed at: the whole tree, or one shard of it.
function eslint_targets(shard: LintShard | undefined): ReadonlyArray<string> {
	if (shard === undefined) return [WHOLE_TREE]

	return shard === FIRST_SHARD ? FIRST_SHARD_DIRECTORIES : second_shard_targets()
}

function checks_formatting(shard: LintShard | undefined): boolean {
	return shard !== SECOND_SHARD
}

// The suffix the scope line carries, so a sharded log is never read as the whole tree's.
function describe(shard: LintShard | undefined): string {
	if (shard === undefined) return ''

	return ` · shard ${String(shard)} of ${String(SECOND_SHARD)}`
}

const lint_shard = {
	FIRST_SHARD_DIRECTORIES,
	FORMATTING_SHARD_REASON,
	WHOLE_TREE,
	checks_formatting,
	describe,
	eslint_targets,
	shard_of,
}

export type { LintShard }
export { lint_shard }
