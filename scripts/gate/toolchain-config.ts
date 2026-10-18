import path from 'node:path'

// The files that move the installed toolchain or what prettier reads, rather than the code a check
// reads: a manifest or lock file moves the installed tools, and an ignore or editor file moves what
// prettier formats. A check that narrows by what changed (`check-inputs.ts`, `lint-gate-scope.ts`)
// cannot narrow past one of these, so each reads its answer here.

const GIT_IGNORE = '.gitignore'
const PRETTIER_IGNORE = '.prettierignore'
const PRETTIER_IGNORE_FILES = [GIT_IGNORE, PRETTIER_IGNORE] as const

const CONFIG_FILES: ReadonlySet<string> = new Set([
	'package.json',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
	'package-lock.json',
	'yarn.lock',
	'bun.lock',
	'bun.lockb',
	'.npmrc',
	'.editorconfig',
	...PRETTIER_IGNORE_FILES,
])

const PRETTIER_CONFIG_PREFIX = '.prettierrc'

function is_config(relative: string): boolean {
	const name = path.basename(relative)

	return CONFIG_FILES.has(name) || name.startsWith(PRETTIER_CONFIG_PREFIX)
}

function has_config(paths: ReadonlyArray<string>): boolean {
	return paths.some((relative) => is_config(relative))
}

const toolchain_config = { has_config, is_config, PRETTIER_IGNORE_FILES }

export { toolchain_config }
