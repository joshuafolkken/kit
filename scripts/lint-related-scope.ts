import path from 'node:path'
import {
	changed_file_scope,
	type ChangedFileScope,
	type ScopeInputs,
	type ScopeVocabulary,
} from './changed-file-scope'
import { ESLINT_CACHE_FLAGS } from './josh/josh-command-types'

// joshuafolkken/kit#1298: `josh lint` read the whole repository on every call, and an
// implementation loop calls it after every few edits. Measured across four runs with
// `pnpm josh time`, that came to 47–188 seconds per run — 18% of #1292's 1,043-second
// implementation phase, spent re-reading files the change never touched.
//
// **This narrowing is added in front of the whole check, never in place of it.** `josh gate` still
// runs `josh lint` over everything before the commit: a formatting rule can be broken by a file the
// change did not name (a shared config, a generated snapshot), and only the whole-tree run sees
// that. What the narrowing replaces is the repeat calls in between.
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

function prettier_arguments(files: ReadonlyArray<string>): ReadonlyArray<string> {
	return [...PRETTIER_ARGS, ...files]
}

// The cache flags are the gate's own, and sharing the cache file is deliberate: eslint's cache
// keeps an entry per file and leaves the entries a run did not visit alone, so a narrowed run warms
// the same cache the whole-tree gate reads instead of invalidating it.
function eslint_arguments(files: ReadonlyArray<string>): ReadonlyArray<string> {
	return [...ESLINT_ARGS, ...files, ...ESLINT_CACHE_FLAGS, ...ESLINT_SCOPED_FLAGS]
}

const lint_related_scope = {
	COMMAND_LABEL,
	COMMAND_NAME,
	NOTHING_LINTABLE_REASON,
	describe_scope,
	eslint_arguments,
	is_lintable,
	prettier_arguments,
	scope_inputs,
}

export { lint_related_scope }
