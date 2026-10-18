import path from 'node:path'
import { lint_related_scope } from '#scripts/lint/lint-related-scope'
import { gate_plan } from './gate-plan'
import { toolchain_config } from './toolchain-config'

// Which paths each gate check reads, so a gate re-run reuses a check none of whose inputs moved
// (`check-reuse.ts`). **A check with no scope here always runs**: `cspell` reads every
// text file, the unit suite reads documents and fixtures as well as code, and `behavior` reads a
// transcript outside the tree. Naming a scope for any of them would be a guess, and a wrong guess is a
// check reported green without having run.
//
// `metrics` reads the scripts it counts, the approvals under `.josh/metrics-accepted/` (JSON) and the
// Markdown it measures (`metrics-command.ts`), so its inputs are the sources plus every `.md` — a
// change of only a spelling list or a workflow file leaves its last green standing
// (joshuafolkken/kit#4085). The merge-base it is held to moving is the base diff `check-reuse.ts`
// already reads.
//
// **The scopes over-approximate, never under**: a path in doubt is an input. `check` and `exports`
// read source modules and the JSON they import. `lint` is prettier plus eslint, so its inputs are those
// sources plus every file prettier formats — the extensions `lint:related` already selects, less what
// prettier's own ignore files leave out (`.claude/**/*.md`). Prettier answers that itself through
// `getFileInfo`, so the two ignore files stay the single source.
//
// **A configuration file is an input of every scoped check**: a manifest or lock file moves the
// installed toolchain, and an ignore or editor file moves what prettier reads.

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

// Whether prettier would leave `relative` out; `false` when prettier cannot be asked, which keeps the
// path an input.
type PrettierIgnored = (relative: string) => Promise<boolean>

type InputTest = (relative: string, is_ignored: PrettierIgnored) => Promise<boolean>

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

function prettier_ignored(root: string): PrettierIgnored {
	const ignore_path = toolchain_config.PRETTIER_IGNORE_FILES.map((name) => path.join(root, name))

	return async function is_ignored(relative: string): Promise<boolean> {
		try {
			const prettier = await import('prettier')
			const info = await prettier.getFileInfo(path.join(root, relative), {
				ignorePath: ignore_path,
			})

			return info.ignored
		} catch {
			return false
		}
	}
}

const SCOPES: ReadonlyMap<string, InputTest> = new Map([
	[gate_plan.LINT_LABEL, is_lint_input],
	[gate_plan.TYPE_CHECK_LABEL, is_source_input],
	[gate_plan.EXPORTS_LABEL, is_source_input],
	[gate_plan.METRICS_LABEL, is_metrics_input],
])

function is_scoped(label: string): boolean {
	return SCOPES.has(label)
}

// Whether any of `paths` (repository-root relative) is an input of the check `label`. An unscoped
// check answers `true` for every set of paths, so the only way to reuse it is never.
async function touches_inputs(
	label: string,
	paths: ReadonlyArray<string>,
	is_ignored: PrettierIgnored,
): Promise<boolean> {
	const scope = SCOPES.get(label)

	if (scope === undefined || toolchain_config.has_config(paths)) return true

	const answers = await Promise.all(
		paths.map(async (relative) => await scope(relative, is_ignored)),
	)

	return answers.includes(true)
}

const check_inputs = { is_scoped, prettier_ignored, touches_inputs }

export type { PrettierIgnored }
export { check_inputs }
