import path from 'node:path'

// joshuafolkken/kit#1257: the unit suite always ran whole. Measured warm on kit, that is 384 files
// and 6,616 tests — 13.9s wall and 110s of CPU, 84% of everything the four gate checks spend, and
// an implementation loop paid it again on every re-check. The same tree narrowed to one changed
// file runs 31 files and 566 tests in 2.4s (7.9s of CPU, −93%).
//
// **This narrowing is added in front of the whole suite, never in place of it.** A test that breaks
// without importing what changed — a marker suite reading a document, a fixture compared against a
// generated file — is invisible to a module graph, so the verification gate keeps running
// `josh test:unit` over everything before the commit.
//
// The decision is here, apart from the process that acts on it, because the one thing it must never
// do is answer "nothing to run" quietly. An empty narrowed set and an unreadable change list both
// end at the full suite, and each says which of the two it was.

type ScopeMode = 'all' | 'related'

interface RelatedScope {
	mode: ScopeMode
	files: ReadonlyArray<string>
	reason: string
}

// The extensions vitest can walk a module graph back from. A changed `.md`, `.yaml` or `.json` is
// dropped rather than passed through: `vitest related` would match no test file for it, and a run
// narrowed to nothing at all is the one outcome this module exists to prevent.
const RELATABLE_EXTENSIONS: ReadonlySet<string> = new Set([
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.svelte',
])

const UNREADABLE_REASON = 'the changed files could not be read'
const NOTHING_RELATABLE_REASON = 'no changed file is one a test can import'

// The command this narrowing belongs to, defined once: the guard prints it when it skips, and the
// line below prints it in front of every decision.
const COMMAND_NAME = 'test:related'
const COMMAND_LABEL = `josh ${COMMAND_NAME}`
const FALLBACK_SUFFIX = 'running the full unit suite instead'
const RELATED_SUFFIX = 'running only the tests related to them'

// Long enough to read a normal change at a glance, short enough that a branch-wide diff does not
// bury the line that says what is about to run.
const LISTED_FILE_LIMIT = 10

const RUN_FLAG = '--run'
const RELATED_SUBCOMMAND = 'related'
const RUN_SUBCOMMAND = 'run'

function is_relatable(file_path: string): boolean {
	return RELATABLE_EXTENSIONS.has(path.extname(file_path))
}

// A path the change lists but the tree no longer holds — deleted, or renamed away — has no module
// either. Left in, it would count towards the narrowed set while contributing no test to it, which
// is how a run of zero tests reports success.
function select_related_files(
	paths: ReadonlyArray<string>,
	is_present: (file_path: string) => boolean,
): Array<string> {
	return paths.filter((file_path) => is_relatable(file_path) && is_present(file_path))
}

function all_scope(reason: string): RelatedScope {
	return { mode: 'all', files: [], reason }
}

// `undefined` and `[]` are deliberately different inputs. The first says the change could not be
// read — git failed, or there is no repository — and the second says it was read and held nothing
// this can narrow by. Both end at the full suite; only the printed reason differs, and a caller
// that collapsed them would lose the distinction the fallback is judged by.
function resolve_scope(
	paths: ReadonlyArray<string> | undefined,
	is_present: (file_path: string) => boolean,
): RelatedScope {
	if (paths === undefined) return all_scope(UNREADABLE_REASON)

	const files = select_related_files(paths, is_present)

	if (files.length === 0) return all_scope(NOTHING_RELATABLE_REASON)

	return { mode: 'related', files, reason: `${String(files.length)} changed file(s)` }
}

function format_file_list(files: ReadonlyArray<string>, root: string): string {
	const listed = files.slice(0, LISTED_FILE_LIMIT).map((file) => `  - ${path.relative(root, file)}`)
	const hidden = files.length - listed.length

	if (hidden > 0) listed.push(`  … and ${String(hidden)} more`)

	return listed.join('\n')
}

// What makes the narrowing readable rather than merely applied: the line names which branch was
// taken, why, and — when it narrowed — every file it narrowed by.
function describe_scope(scope: RelatedScope, root: string): string {
	if (scope.mode === 'all') return `${COMMAND_LABEL}: ${scope.reason} — ${FALLBACK_SUFFIX}.`

	return `${COMMAND_LABEL}: ${scope.reason} — ${RELATED_SUFFIX}.\n${format_file_list(scope.files, root)}`
}

// `--run` is what keeps `vitest related` out of watch mode; the `run` sub-command already implies it
// on the full-suite side, which is why only one of the two branches carries the flag.
function vitest_arguments(
	scope: RelatedScope,
	extra_flags: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
	if (scope.mode === 'all') return [RUN_SUBCOMMAND, ...extra_flags]

	return [RELATED_SUBCOMMAND, ...scope.files, RUN_FLAG, ...extra_flags]
}

const related_scope = {
	COMMAND_LABEL,
	COMMAND_NAME,
	LISTED_FILE_LIMIT,
	NOTHING_RELATABLE_REASON,
	UNREADABLE_REASON,
	describe_scope,
	is_relatable,
	resolve_scope,
	select_related_files,
	vitest_arguments,
}

export type { RelatedScope, ScopeMode }
export { related_scope }
