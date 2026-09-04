import path from 'node:path'
import {
	changed_file_scope,
	type ChangedFileScope,
	type ScopeInputs,
	type ScopeVocabulary,
} from './changed-file-scope'

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
// The decision this file makes is which extensions vitest can walk a module graph back from, and
// what to print about it. Everything the decision shares with `josh lint:related` — reading the
// change, dropping what the tree no longer holds, and the two fallbacks — is
// `changed-file-scope.ts`, so the two commands cannot drift apart about what "changed" means
// (joshuafolkken/kit#1298).

type RelatedScope = ChangedFileScope

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

const { UNREADABLE_REASON } = changed_file_scope
const NOTHING_RELATABLE_REASON = 'no changed file is one a test can import'

// The command this narrowing belongs to, defined once: the guard prints it when it skips, and the
// line below prints it in front of every decision.
const COMMAND_NAME = 'test:related'
const COMMAND_LABEL = `josh ${COMMAND_NAME}`
const { LISTED_FILE_LIMIT } = changed_file_scope

const VOCABULARY: ScopeVocabulary = {
	label: COMMAND_LABEL,
	fallback_suffix: 'running the full unit suite instead',
	narrowed_suffix: 'running only the tests related to them',
}

const RUN_FLAG = '--run'
const RELATED_SUBCOMMAND = 'related'
const RUN_SUBCOMMAND = 'run'

function is_relatable(file_path: string): boolean {
	return RELATABLE_EXTENSIONS.has(path.extname(file_path))
}

// The three inputs that make the shared narrowing this command's, handed over as one value so the
// CLI and the two functions below cannot disagree about any of them.
function scope_inputs(is_present: (file_path: string) => boolean): ScopeInputs {
	return { is_present, is_selectable: is_relatable, nothing_reason: NOTHING_RELATABLE_REASON }
}

function select_related_files(
	paths: ReadonlyArray<string>,
	is_present: (file_path: string) => boolean,
): Array<string> {
	return changed_file_scope.select_files(paths, scope_inputs(is_present))
}

function resolve_scope(
	paths: ReadonlyArray<string> | undefined,
	is_present: (file_path: string) => boolean,
): RelatedScope {
	return changed_file_scope.resolve_scope(paths, scope_inputs(is_present))
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
	UNREADABLE_REASON,
	describe_scope,
	is_relatable,
	resolve_scope,
	scope_inputs,
	select_related_files,
	vitest_arguments,
}

export type { ScopeMode } from './changed-file-scope'
export type { RelatedScope }
export { related_scope }
