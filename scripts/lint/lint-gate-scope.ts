import { existsSync } from 'node:fs'
import path from 'node:path'
import { environment_flags } from '@joshuafolkken/kit/env'
import { gate_labels } from '#scripts/gate/gate-labels'
import { verification_inputs } from '#scripts/gate/verification-inputs'
import {
	changed_file_scope,
	type ChangedFileScope,
	type ScopeVocabulary,
} from '#scripts/git/changed-file-scope'
import {
	ESLINT_CACHE_FILE,
	ESLINT_CACHE_FLAGS,
	PRETTIER_CACHE_FLAGS,
} from '#scripts/josh/josh-command-types'
import { lint_related_scope, type LintCaches } from './lint-related-scope'

// `josh lint --changed` — the lint `josh gate` runs (joshuafolkken/kit#4085): the branch's changed
// files rather than the whole tree.
//
// **Narrowing gives up only the files the branch did not change.** The whole-tree run answers such a
// file from its cache entry unless the files its imports reach changed (`eslint-cache-dependencies.ts`,
// joshuafolkken/kit#4415); this run does not lint it at all, so an unchanged file that a changed
// import broke is caught by the whole-tree run alone. The other files that run actually lints are
// the changed ones, and those are exactly the ones this run names.
//
// What a cache entry does not see falls back to the whole tree: a configuration the lint check declares
// (`verification-inputs.ts`) — a toolchain or ignore file, the eslint configuration and kit's own rules,
// the TypeScript configuration the type-aware rules read — and a change that cannot be read. CI lints the whole tree on every run,
// so the narrowed gate always has the full check behind it.

interface NarrowedLint {
	prettier: ReadonlyArray<string>
	eslint: ReadonlyArray<string>
	eslint_cache_file: string
}

type Environment = Readonly<Record<string, string | undefined>>

const GATE_CACHES: LintCaches = {
	eslint_file: ESLINT_CACHE_FILE,
	eslint_flags: ESLINT_CACHE_FLAGS,
	prettier_flags: PRETTIER_CACHE_FLAGS,
}

const CI_REASON = 'CI lints the whole tree'
const CONFIG_REASON = 'a changed file configures the toolchain or the linters'

const VOCABULARY: ScopeVocabulary = {
	label: 'josh lint --changed',
	fallback_suffix: 'checking the whole tree instead',
	narrowed_suffix: 'checking only them',
}

function all_scope(reason: string): ChangedFileScope {
	return { mode: 'all', files: [], reason }
}

// The lint check's declared configurations (`verification-inputs.ts`), as the since-green narrowing
// reads them too.
function configures_lint(files: ReadonlyArray<string>, root: string): boolean {
	return verification_inputs.configures(
		gate_labels.LINT_LABEL,
		files.map((file) => path.relative(root, file).split(path.sep).join('/')),
	)
}

// `files` are absolute, as `changed_file_scope.read_changed_files` answers them; `undefined` is a
// change that could not be read.
function resolve_gate_scope(
	files: ReadonlyArray<string> | undefined,
	root: string,
	environment: Environment,
): ChangedFileScope {
	if (environment_flags.is_ci_enabled(environment['CI'])) return all_scope(CI_REASON)
	if (files !== undefined && configures_lint(files, root)) return all_scope(CONFIG_REASON)

	return changed_file_scope.resolve_scope(files, lint_related_scope.scope_inputs(existsSync))
}

function narrowed_run(files: ReadonlyArray<string>): NarrowedLint {
	return {
		prettier: lint_related_scope.prettier_arguments(files, GATE_CACHES),
		eslint: lint_related_scope.eslint_arguments(files, GATE_CACHES),
		eslint_cache_file: GATE_CACHES.eslint_file,
	}
}

function describe_scope(scope: ChangedFileScope, root: string): string {
	return changed_file_scope.describe_scope(scope, root, VOCABULARY)
}

const lint_gate_scope = {
	CHANGED_FLAG: '--changed',
	CI_REASON,
	CONFIG_REASON,
	describe_scope,
	narrowed_run,
	resolve_gate_scope,
}

export { lint_gate_scope }
