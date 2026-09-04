import path from 'node:path'
import { changed_paths } from './git/changed-paths'
import { git_command } from './git/git-command'

// The narrowing every scoped re-check shares: which files a check was narrowed by, or why it could
// not be narrowed at all.
//
// joshuafolkken/kit#1257 gave the unit suite this shape and joshuafolkken/kit#1298 gave lint the
// same one. The two differ only in which extensions they can read and in the words they print;
// everything else — where the changed files come from, dropping what the tree no longer holds,
// telling an unreadable change list apart from one that narrowed to nothing, and listing what was
// narrowed by — was identical, so it lives here once rather than in each command.
//
// **A narrowed run is added in front of the whole check, never in place of it.** Both fallbacks
// therefore end at the whole check, and each says which of the two it was: the one thing this must
// never do is answer "nothing to run" quietly.

type ScopeMode = 'all' | 'related'

interface ChangedFileScope {
	mode: ScopeMode
	files: ReadonlyArray<string>
	reason: string
}

// What a scoped command prints around its decision. Kept as data so the shared branch below reads
// the same for every command, and only the words differ.
interface ScopeVocabulary {
	label: string
	fallback_suffix: string
	narrowed_suffix: string
}

interface ScopeInputs {
	is_present: (file_path: string) => boolean
	is_selectable: (file_path: string) => boolean
	nothing_reason: string
}

// Bundled rather than passed one by one: the resolution needs four inputs, and a fourth positional
// parameter is where the project's own limit sits.
interface ScopeRequest {
	command_arguments: ReadonlyArray<string>
	root: string
	inputs: ScopeInputs
}

const UNREADABLE_REASON = 'the changed files could not be read'

// Long enough to read a normal change at a glance, short enough that a branch-wide diff does not
// bury the line that says what is about to run.
const LISTED_FILE_LIMIT = 10

// The root is resolved once and used for both the paths and the line that prints them: relativizing
// the printed list against `process.cwd()` instead would name a file in this repository as
// `../scripts/thing.ts` for anyone running from a subdirectory. Where git cannot answer, `cwd` is
// the honest fallback — the reading below will fail too, and the run falls back to the whole check.
async function repository_root_or_cwd(): Promise<string> {
	try {
		return await git_command.repository_root()
	} catch {
		return process.cwd()
	}
}

// The same reading `josh review:level`, `josh eval:scope` and `josh review:brief` decide from — the
// branch diff plus the untracked files — so what these commands narrow by is what those commands
// call the change, rather than a further definition of it.
//
// **Paths are joined onto the repository root, never onto `process.cwd()`.** Both halves of that
// reading print repository-root-relative paths, so a command typed in a subdirectory would
// otherwise resolve every one of them to a file that does not exist, and the presence filter would
// drop the whole set: a fall back to the whole check that looks exactly like a change with nothing
// to narrow by.
//
// A failure answers `undefined` rather than an empty list: the two are opposite inputs to
// `resolve_scope`, and only one of them means "could not tell".
async function read_changed_files(root: string): Promise<ReadonlyArray<string> | undefined> {
	try {
		const relative_paths = await changed_paths.read_changed_paths(false)

		return relative_paths.map((relative) => path.join(root, relative))
	} catch {
		return undefined
	}
}

// A path the change lists but the tree no longer holds — deleted, or renamed away — has nothing for
// a check to read. Left in, it would count towards the narrowed set while contributing nothing to
// it, which is how a run that checked zero files reports success.
function select_files(
	paths: ReadonlyArray<string>,
	inputs: Pick<ScopeInputs, 'is_present' | 'is_selectable'>,
): Array<string> {
	return paths.filter(
		(file_path) => inputs.is_selectable(file_path) && inputs.is_present(file_path),
	)
}

function all_scope(reason: string): ChangedFileScope {
	return { mode: 'all', files: [], reason }
}

// `undefined` and `[]` are deliberately different inputs. The first says the change could not be
// read; the second says it was read and held nothing this check can narrow by.
function resolve_scope(
	paths: ReadonlyArray<string> | undefined,
	inputs: ScopeInputs,
): ChangedFileScope {
	if (paths === undefined) return all_scope(UNREADABLE_REASON)

	const files = select_files(paths, inputs)

	if (files.length === 0) return all_scope(inputs.nothing_reason)

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
function describe_scope(
	scope: ChangedFileScope,
	root: string,
	vocabulary: ScopeVocabulary,
): string {
	if (scope.mode === 'all') {
		return `${vocabulary.label}: ${scope.reason} — ${vocabulary.fallback_suffix}.`
	}

	return `${vocabulary.label}: ${scope.reason} — ${vocabulary.narrowed_suffix}.\n${format_file_list(scope.files, root)}`
}

// `process.argv` is [runner, script, ...arguments].
const ARGV_START = 2
const FLAG_PREFIX = '-'

function is_flag(argument: string): boolean {
	return argument.startsWith(FLAG_PREFIX)
}

function explicit_files_of(command_arguments: ReadonlyArray<string>): Array<string> {
	return command_arguments.filter((argument) => !is_flag(argument))
}

function flags_of(command_arguments: ReadonlyArray<string>): Array<string> {
	return command_arguments.filter((argument) => is_flag(argument))
}

// Explicit file arguments win over the git reading, which is what makes the narrowing testable by
// hand and usable from a hook that already knows which file it just wrote.
async function resolve_command_scope(request: ScopeRequest): Promise<ChangedFileScope> {
	const explicit_files = explicit_files_of(request.command_arguments)

	if (explicit_files.length === 0) {
		return resolve_scope(await read_changed_files(request.root), request.inputs)
	}

	return resolve_scope(
		explicit_files.map((file) => path.resolve(file)),
		request.inputs,
	)
}

// A file the caller named by hand and this could not use is a mistake worth saying out loud. The
// git-derived set falls back silently on purpose — a change with no file this check reads is
// ordinary — but a typed path that resolves to nothing would otherwise be answered with a reason
// describing a set the caller never handed over.
function report_unusable_arguments(
	command_arguments: ReadonlyArray<string>,
	scope: ChangedFileScope,
	label: string,
): void {
	const narrowed = new Set(scope.files)
	const unusable = explicit_files_of(command_arguments).filter(
		(file) => !narrowed.has(path.resolve(file)),
	)

	if (unusable.length === 0) return

	process.stdout.write(`${label}: ignored — not a file this check reads: ${unusable.join(' ')}\n`)
}

const changed_file_scope = {
	ARGV_START,
	LISTED_FILE_LIMIT,
	UNREADABLE_REASON,
	describe_scope,
	explicit_files_of,
	flags_of,
	is_flag,
	read_changed_files,
	report_unusable_arguments,
	repository_root_or_cwd,
	resolve_command_scope,
	resolve_scope,
	select_files,
}

export type { ChangedFileScope, ScopeInputs, ScopeMode, ScopeRequest, ScopeVocabulary }
export { changed_file_scope }
