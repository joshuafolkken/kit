import path from 'node:path'
import {
	changed_file_scope,
	type ChangedFileScope,
	type ScopeInputs,
	type ScopeVocabulary,
} from '#scripts/git/changed-file-scope'
import {
	ESLINT_RELATED_CACHE_FILE,
	ESLINT_RELATED_CACHE_FLAGS,
	PRETTIER_RELATED_CACHE_FLAGS,
} from '#scripts/josh/josh-command-types'
import type { CrossFileRecheckOptions } from './cross-file-recheck'

// `josh lint` reads the whole repository on every call, and an implementation loop calls it after
// every few edits — re-reading files the change never touched.
//
// The gate narrows its own lint the same way, with its own caches and a whole-tree fallback for a
// changed toolchain or lint configuration (`lint-gate-scope.ts`), and CI lints the whole tree.
//
// The decision this file makes is which extensions the two linters read, and how each of them is
// asked about a file list instead of a directory. Everything it shares with `josh test:related` —
// reading the change, dropping what the tree no longer holds, and the two fallbacks — is
// `changed-file-scope.ts`.

// What prettier or eslint reads in a kit project. A changed image, font or archive is dropped
// rather than passed through: neither linter has anything to say about it, so a run narrowed to one
// of them would check nothing while reporting success.
//
// **A lock file is not dropped here** — `.yaml` and `.json` are on this list because a hand-written
// config of either kind is prettier's to check. `pnpm-lock.yaml` therefore reaches both children
// and is skipped by each on its own terms: `.prettierignore` names it, and eslint has no
// configuration matching it. That is the same treatment the whole-tree `josh lint` gives it.
const LINTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.svelte',
	'.vue',
	'.md',
	'.mdx',
	'.json',
	'.jsonc',
	'.json5',
	'.yaml',
	'.yml',
	'.css',
	'.scss',
	'.less',
	'.html',
	'.graphql',
	'.gql',
])

const NOTHING_LINTABLE_REASON = 'no changed file is one prettier or eslint reads'

const COMMAND_NAME = 'lint:related'
const COMMAND_LABEL = `josh ${COMMAND_NAME}`

const VOCABULARY: ScopeVocabulary = {
	label: COMMAND_LABEL,
	fallback_suffix: 'checking the whole tree instead',
	narrowed_suffix: 'checking only them',
}

// `--ignore-unknown` is what lets one file list go to prettier whole: a `.svelte` file prettier has
// no plugin for, or an extension it does not parse, is skipped rather than failing the run. Without
// it, prettier exits non-zero on the first file it cannot read, which is a failure about the file
// list rather than about the code.
const PRETTIER_ARGS = ['exec', 'prettier', '--check', '--ignore-unknown'] as const
// `--no-warn-ignored` is the counterpart on the eslint side. A changed `.md` or a file under an
// `ignores` entry is passed in with the rest, and eslint warns once per such file when it is named
// explicitly — noise that would bury the findings the run exists to show.
const ESLINT_ARGS = ['exec', 'eslint'] as const
const ESLINT_SCOPED_FLAGS = ['--no-warn-ignored'] as const

function is_lintable(file_path: string): boolean {
	return LINTABLE_EXTENSIONS.has(path.extname(file_path))
}

// The three inputs that make the shared narrowing this command's, handed over as one value so the
// CLI and the function below cannot disagree about any of them.
function scope_inputs(is_present: (file_path: string) => boolean): ScopeInputs {
	return { is_present, is_selectable: is_lintable, nothing_reason: NOTHING_LINTABLE_REASON }
}

function describe_scope(scope: ChangedFileScope, root: string): string {
	return changed_file_scope.describe_scope(scope, root, VOCABULARY)
}

// Where a narrowed run keeps its caches. `josh lint:related` keeps its own and the gate its own, for
// the reason `eslint_arguments` gives below; a narrowed gate run on the gate's caches loses none of
// the whole-tree entries, since a file it does not visit is not pruned (`josh-command-types.ts`).
interface LintCaches {
	eslint_file: string
	eslint_flags: ReadonlyArray<string>
	prettier_flags: ReadonlyArray<string>
}

const RELATED_CACHES: LintCaches = {
	eslint_file: ESLINT_RELATED_CACHE_FILE,
	eslint_flags: ESLINT_RELATED_CACHE_FLAGS,
	prettier_flags: PRETTIER_RELATED_CACHE_FLAGS,
}

// The scoped run's own cache file, for the reason eslint's below gives: prettier too rewrites its
// cache file whole, so a narrowed run sharing the gate's would discard entries a concurrent gate wrote.
function prettier_arguments(
	files: ReadonlyArray<string>,
	caches: LintCaches = RELATED_CACHES,
): ReadonlyArray<string> {
	return [...PRETTIER_ARGS, ...files, ...caches.prettier_flags]
}

// The cache file is this command's own rather than the gate's, because the two run at the same time.
// `josh gate` lints beside the review while an
// implementation loop calls this command between edits, and each eslint run rewrites its cache file
// whole from the copy it loaded at start-up — so on one file the run that finished last would
// discard the other's entries, and a narrowed run finishing during a whole-tree run would roll the
// cache back to its pre-gate state. Sharing would let a narrowed run warm the gate's cache only for
// pruning, which says nothing about two writers. It is the same judgement the edit hook's own cache
// file makes.
function eslint_arguments(
	files: ReadonlyArray<string>,
	caches: LintCaches = RELATED_CACHES,
): ReadonlyArray<string> {
	return [...ESLINT_ARGS, ...files, ...caches.eslint_flags, ...ESLINT_SCOPED_FLAGS]
}

// What re-reading a cached cross-file report (`cross-file-recheck.ts`) needs to ask the narrowed run's question
// again: the same targets, the same cache file, and the Node API's spelling of `--no-warn-ignored`.
function cross_file_recheck_options(
	files: ReadonlyArray<string>,
	caches: LintCaches = RELATED_CACHES,
): CrossFileRecheckOptions {
	return {
		cache_file: caches.eslint_file,
		patterns: files,
		eslint_options: { warnIgnored: false },
	}
}

const lint_related_scope = {
	COMMAND_LABEL,
	cross_file_recheck_options,
	NOTHING_LINTABLE_REASON,
	describe_scope,
	eslint_arguments,
	is_lintable,
	prettier_arguments,
	scope_inputs,
}

export type { LintCaches }
export { lint_related_scope }
