import path from 'node:path'
import { changed_file_scope, type ChangedFileScope } from '#scripts/git/changed-file-scope'
import { test_read_map, type ReadMap } from './test-read-map'
import { unit_setup_files } from './unit-setup-files'

// The whole unit suite is expensive. Measured warm on kit, that is 384 files
// and 6,616 tests — 13.9s wall and 110s of CPU, 84% of everything the four gate checks spend, and
// an implementation loop paid it again on every re-check. The same tree narrowed to one changed
// file runs 31 files and 566 tests in 2.4s (7.9s of CPU, −93%).
//
// **The verification gate runs this narrowing in place of the whole suite** (joshuafolkken/kit#4065),
// which is safe only because it reaches every test a change can break. A changed module reaches
// the tests importing it through `vitest related`, and the tests reading it as data through the
// test-read map a whole-suite run records (`test-read-map.ts`). A changed document, config or
// snapshot — which no module graph holds — reaches the modules that read it through that map alone. **Whatever neither can answer runs the whole suite**: no map, a
// non-code file no recorded test read, or a file every test depends on. CI runs the whole suite
// regardless, so a read the recorder could not see — one a child process makes — is still caught
// before the merge.
//
// Everything the decision shares with `josh lint:related` — the fallback line, the file listing and
// the unreadable-change reason — is `changed-file-scope.ts`, so the two commands cannot drift apart
// about what they print.

type RelatedScope = ChangedFileScope

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

// The files every test depends on without importing or reading them: the package and its lock,
// the vitest configuration, and the setup files every worker runs before every test.
const SETUP_FILES: ReadonlyArray<string> = [
	...unit_setup_files.NETWORK_GUARD,
	...unit_setup_files.STATE_GUARD,
	...unit_setup_files.WORKER_GUARDS,
	...unit_setup_files.READ_RECORDER,
].map((file) => path.normalize(file))

const WHOLE_SUITE_FILES: ReadonlySet<string> = new Set([
	'package.json',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
	'tsconfig.json',
	'vitest.config.ts',
	'vitest.harness.config.ts',
	path.join('scripts', 'test', 'unit-projects.ts'),
	path.join('scripts', 'test', 'unit-setup-files.ts'),
	path.join('scripts', 'test', 'pure-files.ts'),
	path.join('scripts', 'test', 'vitest-include-globs.ts'),
	// What the read recorder runs in every worker, which no test imports through the setup file.
	path.join('scripts', 'test', 'test-read-capture.ts'),
	path.join('scripts', 'test', 'test-read-trace.ts'),
	...SETUP_FILES,
])

const { UNREADABLE_REASON } = changed_file_scope
const NOTHING_RELATABLE_REASON = 'no changed file is one a test can import or read'
const NO_MAP_REASON = 'no test-read map covers the changed non-code file'

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

const RUN_FLAG = '--run'
const RELATED_SUBCOMMAND = 'related'
const RUN_SUBCOMMAND = 'run'

// Bundled so the CLI and the tests hand the decision the same four facts.
interface ScopeRequest {
	root: string
	// Repository-root-relative paths, or `undefined` when the change could not be read.
	changed: ReadonlyArray<string> | undefined
	map: ReadMap | undefined
	is_present: (file_path: string) => boolean
}

// Either the modules the changed non-code files resolve to, or why they cannot be resolved.
type MapResolution = { files: Array<string> } | { reason: string }

function is_relatable(file_path: string): boolean {
	return RELATABLE_EXTENSIONS.has(path.extname(file_path))
}

function all_scope(reason: string): RelatedScope {
	return { mode: 'all', files: [], reason }
}

function resolve_through_map(
	others: ReadonlyArray<string>,
	map: ReadMap | undefined,
): MapResolution {
	if (others.length === 0) return { files: [] }
	if (map === undefined) return { reason: `${NO_MAP_REASON} ${String(others[0])}` }

	const unread = others.find((file) => test_read_map.readers_of(map, file).length === 0)

	if (unread !== undefined) return { reason: `${unread} is read by no recorded test` }

	return { files: others.flatMap((file) => test_read_map.readers_of(map, file)) }
}

// A changed module is also data to a test that reads it through `fs` rather than importing it, and
// `vitest related` cannot see that read. Unlike a non-code file, a module the map does not hold
// still narrows — through the module graph alone.
function code_readers(code: ReadonlyArray<string>, map: ReadMap | undefined): Array<string> {
	if (map === undefined) return []

	return code.flatMap((file) => test_read_map.readers_of(map, file))
}

function narrowed_scope(files: ReadonlyArray<string>, request: ScopeRequest): RelatedScope {
	const present = [...new Set(files)]
		.map((file) => path.join(request.root, file))
		.filter((file) => request.is_present(file))

	if (present.length === 0) return all_scope(NOTHING_RELATABLE_REASON)

	return { mode: 'related', files: present, reason: `${String(present.length)} related file(s)` }
}

// `undefined` and `[]` are deliberately different inputs. The first says the change could not be
// read; the second says it was read and held nothing to relate.
function resolve_scope(request: ScopeRequest): RelatedScope {
	const { changed } = request

	if (changed === undefined) return all_scope(UNREADABLE_REASON)

	const whole = changed.find((file) => WHOLE_SUITE_FILES.has(file))

	if (whole !== undefined) return all_scope(`${whole} affects every test`)

	const code = changed.filter((file) => is_relatable(file))
	const resolution = resolve_through_map(
		changed.filter((file) => !is_relatable(file)),
		request.map,
	)

	if ('reason' in resolution) return all_scope(resolution.reason)

	return narrowed_scope([...code, ...code_readers(code, request.map), ...resolution.files], request)
}

function describe_scope(scope: RelatedScope, root: string): string {
	return changed_file_scope.describe_scope(scope, root, VOCABULARY)
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
	NO_MAP_REASON,
	UNREADABLE_REASON,
	describe_scope,
	is_relatable,
	resolve_scope,
	vitest_arguments,
}

export type { ScopeMode } from '#scripts/git/changed-file-scope'
export type { ScopeRequest }
export { related_scope }
