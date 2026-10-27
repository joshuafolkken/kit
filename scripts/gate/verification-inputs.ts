import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { lint_related_scope } from '#scripts/lint/lint-related-scope'
import { gate_plan } from './gate-plan'
import { input_fingerprint } from './input-fingerprint'
import { toolchain_inputs } from './toolchain-inputs'

// **What each verification depends on, declared once** (joshuafolkken/kit#4495). Every reuse of a
// verdict — the whole gate (`gate-skip.ts`), one check (`check-reuse.ts`), a scoped record
// (`scoped-green.ts`) and the since-green narrowing (`since-green.ts`) — answers from the declaration
// here — the paths through `check-inputs.ts`, the tools and environment through `fingerprint` — so a
// new reuse picks a declaration rather than writing its own invalidation.
//
// A declaration names:
// - `is_input` — whether a path is a content input; `undefined` leaves it to `reads`.
// - `reads` — `matched`: the inputs are the paths `is_input` accepts. `recorded`: the inputs are the
//   files a run read, as the run recorded them — the test-read map (joshuafolkken/kit#4314), whose
//   file digests are `input-fingerprint.ts`'s — so a path is an input only when some recorded test
//   reads it.
// - `is_config` — the files that configure the check: one that moves invalidates the verdict whatever
//   else moved, and stops the since-green narrowing.
// - `tools` — the packages whose installed version runs the check.
// - `env` — the environment variables whose value changes the verdict.
//
// **A check with no declaration always runs**: `cspell` reads every text file and `behavior` reads a
// transcript outside the tree. Naming inputs for either would be a guess, and a wrong guess is a check
// reported green without having run. **The declarations over-approximate, never under**: a path in
// doubt is an input. `metrics` reads the scripts it counts, the approvals under
// `.josh/metrics-accepted/` (JSON) and the Markdown it measures (joshuafolkken/kit#4085). `lint` is
// prettier plus eslint, so its inputs are the sources plus every file prettier formats, less what
// prettier's own ignore files leave out — prettier answers that itself (`check-inputs.ts`).

const GIT_IGNORE = '.gitignore'
const PRETTIER_IGNORE = '.prettierignore'
const PRETTIER_IGNORE_FILES = [GIT_IGNORE, PRETTIER_IGNORE] as const

// A manifest or lock file moves the installed tools (`toolchain-inputs.ts`, the list every kept result
// shares), and an ignore or editor file moves what prettier formats — a configuration of every
// declared check.
const MANIFEST = 'package.json'

const TOOLCHAIN_FILES: ReadonlySet<string> = new Set([
	...toolchain_inputs.PACKAGE_FILES.map((relative) => path.basename(relative)),
	'.editorconfig',
	...PRETTIER_IGNORE_FILES,
])

const PRETTIER_CONFIG_PREFIX = '.prettierrc'

// A file name starting with one of these configures the TypeScript program a check compiles, and the
// test runner for the unit step.
const COMPILER_CONFIG_PREFIXES = ['tsconfig', 'svelte.config.'] as const
const TEST_CONFIG_PREFIXES = [...COMPILER_CONFIG_PREFIXES, 'vitest.config.', 'vite.config.']

// A file name starting with one of these, or a path under one of the directories, configures prettier,
// eslint or the TypeScript program its type-aware rules read. Prettier keys its cache on the options
// too, so a changed `prettier.config.*` re-checks every file the whole-tree run reads.
const LINT_CONFIG_PREFIXES = ['eslint.config.', 'prettier.config.', ...COMPILER_CONFIG_PREFIXES]
const LINT_CONFIG_DIRECTORIES: ReadonlySet<string> = new Set(['eslint', 'prettier', 'tsconfig'])

const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
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
	'.json',
	'.jsonc',
])

const MARKDOWN_EXTENSION = '.md'
// `NODE_OPTIONS` is left out: package managers and hooks set it differently around the same check,
// and it tunes the runtime rather than what a check answers.
const COMMON_ENV = ['NODE_ENV'] as const
const ABSENT = 'absent'

type Environment = Readonly<Record<string, string | undefined>>

// Whether prettier would leave `relative` out; `false` when prettier cannot be asked, which keeps the
// path an input.
type PrettierIgnored = (relative: string) => Promise<boolean>

type FileTest = (relative: string, is_ignored: PrettierIgnored) => Promise<boolean>

type InputReads = 'matched' | 'recorded'

interface InputDeclaration {
	readonly is_input: FileTest | undefined
	readonly reads: InputReads
	readonly is_config: (relative: string) => boolean
	readonly tools: ReadonlyArray<string>
	readonly env: ReadonlyArray<string>
}

function is_source(relative: string): boolean {
	return SOURCE_EXTENSIONS.has(path.extname(relative))
}

async function is_lint_input(relative: string, is_ignored: PrettierIgnored): Promise<boolean> {
	if (is_source(relative)) return true
	if (!lint_related_scope.is_lintable(relative)) return false

	return !(await is_ignored(relative))
}

async function is_source_input(relative: string): Promise<boolean> {
	return is_source(relative)
}

async function is_metrics_input(relative: string): Promise<boolean> {
	return is_source(relative) || path.extname(relative) === MARKDOWN_EXTENSION
}

function configures_toolchain(relative: string): boolean {
	const name = path.basename(relative)

	return TOOLCHAIN_FILES.has(name) || name.startsWith(PRETTIER_CONFIG_PREFIX)
}

function names_any(relative: string, prefixes: ReadonlyArray<string>): boolean {
	const name = path.basename(relative)

	return configures_toolchain(relative) || prefixes.some((prefix) => name.startsWith(prefix))
}

function configures_compiler(relative: string): boolean {
	return names_any(relative, COMPILER_CONFIG_PREFIXES)
}

function configures_tests(relative: string): boolean {
	return names_any(relative, TEST_CONFIG_PREFIXES)
}

function configures_lint(relative: string): boolean {
	const [top = ''] = relative.split('/', 1)

	return LINT_CONFIG_DIRECTORIES.has(top) || names_any(relative, LINT_CONFIG_PREFIXES)
}

const LINT: InputDeclaration = {
	is_input: is_lint_input,
	reads: 'matched',
	is_config: configures_lint,
	tools: ['prettier', 'eslint', 'typescript'],
	env: COMMON_ENV,
}

const UNIT: InputDeclaration = {
	is_input: undefined,
	reads: 'recorded',
	is_config: configures_tests,
	tools: ['vitest', 'typescript'],
	env: [...COMMON_ENV, 'TZ'],
}

function compiled(is_input: FileTest): InputDeclaration {
	return {
		is_input,
		reads: 'matched',
		is_config: configures_compiler,
		tools: ['typescript'],
		env: COMMON_ENV,
	}
}

// **cspell reads every file with dotfiles**, so any moved file — its config and word lists among
// them — answers "run again" (joshuafolkken/kit#5156).
async function is_any_file(): Promise<boolean> {
	return true
}

const SPELLING: InputDeclaration = {
	is_input: is_any_file,
	reads: 'matched',
	is_config: configures_toolchain,
	tools: ['cspell'],
	env: COMMON_ENV,
}

const DECLARATIONS: ReadonlyMap<string, InputDeclaration> = new Map([
	[gate_plan.LINT_LABEL, LINT],
	[gate_plan.SPELL_CHECK_LABEL, SPELLING],
	[gate_plan.TYPE_CHECK_LABEL, compiled(is_source_input)],
	[gate_plan.EXPORTS_LABEL, compiled(is_source_input)],
	[gate_plan.METRICS_LABEL, compiled(is_metrics_input)],
	[gate_plan.UNIT_LABEL, UNIT],
])

function declaration_of(label: string): InputDeclaration | undefined {
	return DECLARATIONS.get(label)
}

function is_declared(label: string): boolean {
	return DECLARATIONS.has(label)
}

// Whether any of `relatives` (repository-root relative) configures the check `label` — `true` for an
// undeclared one, which no narrowing can read past.
function configures(label: string, relatives: ReadonlyArray<string>): boolean {
	const declaration = DECLARATIONS.get(label)

	return declaration === undefined || relatives.some((relative) => declaration.is_config(relative))
}

function tool_version(root: string, tool: string): string {
	try {
		const manifest: unknown = JSON.parse(
			readFileSync(path.join(root, 'node_modules', tool, MANIFEST), 'utf8'),
		)

		return typeof manifest === 'object' && manifest !== null && 'version' in manifest
			? String(manifest.version)
			: ABSENT
	} catch {
		return ABSENT
	}
}

function entries_of(
	declaration: InputDeclaration,
	root: string,
	environment: Environment,
): ReadonlyArray<string> {
	return [
		...declaration.tools.map((tool) => `tool:${tool}=${tool_version(root, tool)}`),
		...declaration.env.map((name) => `env:${name}=${environment[name] ?? ABSENT}`),
	]
}

// **The fingerprint of what the checks `labels` read beside the files**: the installed version of every
// declared tool and the value of every declared environment variable, sorted into one digest. The
// file contents are the record's own file map (`file-map-stamp.ts`) and the merge base its `base`, so a
// reuse matches all three. One label answers a check's record; every declared label the whole gate's.
function fingerprint(
	labels: ReadonlyArray<string>,
	root: string = PROJECT_ROOT,
	environment: Environment = process.env,
): string {
	const declarations = labels.flatMap((label) => DECLARATIONS.get(label) ?? [])
	const entries = new Set(
		declarations.flatMap((declaration) => entries_of(declaration, root, environment)),
	)

	return input_fingerprint.of_entries(entries)
}

const DECLARED_LABELS: ReadonlyArray<string> = [...DECLARATIONS.keys()]

const verification_inputs = {
	configures,
	declaration_of,
	DECLARED_LABELS,
	fingerprint,
	is_declared,
	PRETTIER_IGNORE_FILES,
}

export type { InputDeclaration, InputReads, PrettierIgnored }
export { verification_inputs }
