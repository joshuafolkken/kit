import path from 'node:path'
import { changed_file_scope, type ChangedFileScope } from '#scripts/git/changed-file-scope'
import { test_read_map, type ReadMap } from './test-read-map'
import { whole_suite_files } from './whole-suite-files'

// The whole unit suite is expensive — the largest share of what the gate checks spend, and an
// implementation loop paid it again on every re-check — while one changed file narrows it to a small
// fraction. `josh lane:stats` reports what `test:unit` costs now.
//
// **The verification gate runs this narrowing in place of the whole suite** (joshuafolkken/kit#4065),
// which is safe only because it reaches every test a change can break. A changed module reaches
// the tests importing it through `vitest related`, and the tests reading it as data through the
// test-read map a whole-suite run records (`test-read-map.ts`). A changed document, config or
// snapshot — which no module graph holds — reaches the modules that read it through that map alone. **Whatever neither can answer runs the whole suite**: no map, a
// non-code file added since the recorded tree that no recorded test read, where a test read inside its
// directory or the tree did not hold it, or a file every test
// depends on. A non-code file the recorded tree already held and no test read is one no test reads
// (joshuafolkken/kit#4073), and so is one added since to a directory the tree held and no test read
// inside (joshuafolkken/kit#4303), so a change made only of those runs nothing. CI runs the whole suite
// regardless, so a read the recorder could not see — one a child process makes — is still caught
// before the merge.
//
// Everything the decision shares with `josh lint:related` — the fallback line, the file listing and
// the unreadable-change reason — is `changed-file-scope.ts`, so the two commands cannot drift apart
// about what they print.

// The third answer only this command has: the change is known to reach no test, so nothing runs.
// `files` holds the changed files that settled it, for the line that says why.
interface NoTestScope {
	mode: 'none'
	files: ReadonlyArray<string>
	reason: string
}

type RelatedScope = ChangedFileScope | NoTestScope

// The extensions vitest can walk a module graph back from. Every other changed file is resolved
// through the test-read map instead.
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

const { WHOLE_SUITE_FILES } = whole_suite_files
const { UNREADABLE_REASON } = changed_file_scope
const NOTHING_RELATABLE_REASON = 'no changed file is one a test can import or read'
const NO_MAP_REASON = 'no test-read map covers the changed non-code file'
const UNMOVED_REASON = 'nothing moved since its last green run on this checkout'
const WHOLE_SUITE_SUFFIX = 'affects every test'
const UNRECORDED_SUFFIX = 'is read by no recorded test'

// The stable kind each full-suite reason falls under, so the gate ledger counts the fallbacks by why
// rather than by the file a reason names (joshuafolkken/kit#4397).
const FALLBACK_KINDS: ReadonlyArray<{ kind: string; reason: string }> = [
	{ kind: 'unreadable', reason: UNREADABLE_REASON },
	{ kind: 'nothing-relatable', reason: NOTHING_RELATABLE_REASON },
	{ kind: 'no-map', reason: NO_MAP_REASON },
	{ kind: 'whole-suite-file', reason: WHOLE_SUITE_SUFFIX },
	{ kind: 'unrecorded-file', reason: UNRECORDED_SUFFIX },
]
const OTHER_FALLBACK = 'other'

// The command this narrowing belongs to, defined once: the guard prints it when it skips, and the
// line below prints it in front of every decision.
const COMMAND_NAME = 'test:related'
const COMMAND_LABEL = `josh ${COMMAND_NAME}`
const { LISTED_FILE_LIMIT } = changed_file_scope

const VOCABULARY = {
	label: COMMAND_LABEL,
	fallback_suffix: 'running the full unit suite instead',
	narrowed_suffix: 'running only the tests related to them',
}

const NONE_SUFFIX = 'running no tests'

const RUN_FLAG = '--run'
const RELATED_SUBCOMMAND = 'related'
const RUN_SUBCOMMAND = 'run'

// Bundled so the CLI and the tests hand the decision the same five facts.
interface ScopeRequest {
	root: string
	// Repository-root-relative paths, or `undefined` when the change could not be read.
	changed: ReadonlyArray<string> | undefined
	map: ReadMap | undefined
	// The changed non-code files the map's tree held, and that did not differ from it when the map
	// was recorded — the ones whose having no reader in the map means no test reads them.
	recorded: ReadonlySet<string>
	is_present: (file_path: string) => boolean
}

// What the decision narrows to: the files to hand vitest, and the changed files known to reach no
// test.
interface Selection {
	files: ReadonlyArray<string>
	unread: ReadonlyArray<string>
}

// Either the selection the changed non-code files resolve to, or why they cannot be resolved — with
// the repository-root-relative files that sent the run to the whole suite, where a file did.
type MapResolution = Selection | { reason: string; triggers?: ReadonlyArray<string> }

function is_relatable(file_path: string): boolean {
	return RELATABLE_EXTENSIONS.has(path.extname(file_path))
}

// A full-suite scope's `files` are the changed files that sent it there (joshuafolkken/kit#4510), as a
// `none` scope's are the ones that settled it; the printed line still names only the first.
function all_scope(reason: string, triggers: ReadonlyArray<string> = [], root = ''): RelatedScope {
	return { mode: 'all', files: triggers.map((file) => path.join(root, file)), reason }
}

// A file no recorded test read narrows only when the recorded tree held it, or held its directory and
// no recorded test read inside that: any other file added since is one the recorder never saw, so its
// having no reader says nothing.
function resolve_through_map(others: ReadonlyArray<string>, request: ScopeRequest): MapResolution {
	const { map, recorded } = request

	if (others.length === 0) return { files: [], unread: [] }
	if (map === undefined) return { reason: `${NO_MAP_REASON} ${String(others[0])}` }

	const unread = others.filter((file) => test_read_map.readers_of(map, file).length === 0)
	const unknown = unread.filter(
		(file) => !recorded.has(file) && !test_read_map.in_unread_directory(map, file),
	)

	if (unknown.length > 0) {
		return { reason: `${String(unknown[0])} ${UNRECORDED_SUFFIX}`, triggers: unknown }
	}

	return { files: others.flatMap((file) => test_read_map.readers_of(map, file)), unread }
}

// A changed module is also data to a test that reads it through `fs` rather than importing it, and
// `vitest related` cannot see that read. Unlike a non-code file, a module the map does not hold
// still narrows — through the module graph alone.
function code_readers(code: ReadonlyArray<string>, map: ReadMap | undefined): Array<string> {
	if (map === undefined) return []

	return code.flatMap((file) => test_read_map.readers_of(map, file))
}

function none_scope(unread: ReadonlyArray<string>, root: string): NoTestScope {
	const files = unread.map((file) => path.join(root, file))

	return { mode: 'none', files, reason: `${String(files.length)} changed file(s) no test reads` }
}

// Nothing to select is "no test" only when something settled it; an empty or vanished selection
// still runs the whole suite.
function narrowed_scope(selection: Selection, request: ScopeRequest): RelatedScope {
	if (selection.files.length === 0 && selection.unread.length > 0) {
		return none_scope(selection.unread, request.root)
	}

	const present = [...new Set(selection.files)]
		.map((file) => path.join(request.root, file))
		.filter((file) => request.is_present(file))

	if (present.length === 0) return all_scope(NOTHING_RELATABLE_REASON)

	return { mode: 'related', files: present, reason: `${String(present.length)} related file(s)` }
}

// `undefined` and `[]` are deliberately different inputs. The first says the change could not be
// read; the second says it was read and held nothing to relate.
function resolve_scope(request: ScopeRequest): RelatedScope {
	const { changed, root } = request

	if (changed === undefined) return all_scope(UNREADABLE_REASON)

	const whole = changed.filter((file) => WHOLE_SUITE_FILES.has(file))

	if (whole.length > 0) return all_scope(`${String(whole[0])} ${WHOLE_SUITE_SUFFIX}`, whole, root)

	const code = changed.filter((file) => is_relatable(file))
	const resolution = resolve_through_map(
		changed.filter((file) => !is_relatable(file)),
		request,
	)

	if ('reason' in resolution) return all_scope(resolution.reason, resolution.triggers, root)

	const files = [...code, ...code_readers(code, request.map), ...resolution.files]

	return narrowed_scope({ files, unread: resolution.unread }, request)
}

function describe_scope(scope: RelatedScope, root: string): string {
	if (scope.mode !== 'none') return changed_file_scope.describe_scope(scope, root, VOCABULARY)

	const listing = changed_file_scope.format_file_list(scope.files, root)

	return `${COMMAND_LABEL}: ${scope.reason} — ${NONE_SUFFIX}.\n${listing}`
}

function reason_kind(reason: string): string {
	return FALLBACK_KINDS.find((entry) => reason.includes(entry.reason))?.kind ?? OTHER_FALLBACK
}

// The kind of full-suite fallback a run's output names, read off the line `describe_scope` printed, or
// `undefined` when the run narrowed or ran nothing.
function fallback_kind(output: string): string | undefined {
	const prefix = `${COMMAND_LABEL}: `
	const suffix = ` — ${VOCABULARY.fallback_suffix}.`
	const line = output
		.split('\n')
		.map((candidate) => candidate.trim())
		.find((candidate) => candidate.startsWith(prefix) && candidate.endsWith(suffix))

	if (line === undefined) return undefined

	return reason_kind(line.slice(prefix.length, -suffix.length))
}

// The stable name a scope is recorded under: its mode when it narrowed or ran nothing, else the kind of
// full-suite fallback its reason falls under (joshuafolkken/kit#4465).
function scope_kind(scope: RelatedScope): string {
	return scope.mode === 'all' ? reason_kind(scope.reason) : scope.mode
}

// Whether a run's output is the since-green no-op — nothing moved, so no test ran — read off the line
// `describe_scope` printed, so the gate ledger never times it as a unit run (joshuafolkken/kit#4457).
function is_unmoved(output: string): boolean {
	const line = `${COMMAND_LABEL}: ${UNMOVED_REASON} — ${NONE_SUFFIX}.`

	return output.split('\n').some((candidate) => candidate.trim() === line)
}

// `--run` is what keeps `vitest related` out of watch mode; the `run` sub-command already implies it
// on the full-suite side, which is why only one of the two branches carries the flag.
function vitest_arguments(
	scope: RelatedScope,
	extra_flags: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
	if (scope.mode !== 'related') return [RUN_SUBCOMMAND, ...extra_flags]

	return [RELATED_SUBCOMMAND, ...scope.files, RUN_FLAG, ...extra_flags]
}

const related_scope = {
	COMMAND_LABEL,
	COMMAND_NAME,
	LISTED_FILE_LIMIT,
	NOTHING_RELATABLE_REASON,
	NO_MAP_REASON,
	UNMOVED_REASON,
	UNREADABLE_REASON,
	describe_scope,
	fallback_kind,
	is_relatable,
	is_unmoved,
	resolve_scope,
	scope_kind,
	vitest_arguments,
}

export type { ScopeMode } from '#scripts/git/changed-file-scope'
export type { RelatedScope, ScopeRequest }
export { related_scope }
