#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import {
	CSPELL_COMMIT_CACHE_FLAGS,
	ESLINT_COMMIT_CACHE_FLAGS,
	PRETTIER_CACHE_FLAGS,
} from '#scripts/josh/josh-command-types'
import { resolve_spawn_exit } from '#scripts/lib/spawn-exit'
import { execa } from 'execa'

// The pre-commit hook's cspell, prettier and eslint runs over the staged files. They go through here
// rather than a bare `pnpm exec` in `lefthook/base.yml` so each cache location comes from the
// constant its ignore rules are asserted against (joshuafolkken/kit#3948) — a YAML copy would keep
// writing the old file the day that constant moves.
//
// cspell and eslint write the hook's own files: a staged-files cspell run prunes every entry it did
// not visit, and `--quiet` stores eslint reports without their warnings. Prettier does neither, so
// it shares the gate's file and a commit right after a green gate checks nothing twice.

const ARGV_OFFSET = 2
const USAGE_ERROR_EXIT_CODE = 2
const PNPM = 'pnpm'

const TOOL_ARGUMENTS: Readonly<Record<string, ReadonlyArray<string>>> = {
	cspell: [
		'exec',
		'cspell',
		'lint',
		'--no-must-find-files',
		'--no-progress',
		...CSPELL_COMMIT_CACHE_FLAGS,
	],
	prettier: ['exec', 'prettier', '--check', '--ignore-unknown', ...PRETTIER_CACHE_FLAGS],
	eslint: ['exec', 'eslint', '--quiet', ...ESLINT_COMMIT_CACHE_FLAGS],
}

const USAGE = `Usage: josh pre-commit-lint <${Object.keys(TOOL_ARGUMENTS).join('|')}> [files...]`

function build_arguments(
	tool: string,
	staged_files: ReadonlyArray<string>,
): ReadonlyArray<string> | undefined {
	const tool_arguments = TOOL_ARGUMENTS[tool]
	if (tool_arguments === undefined) return undefined

	return [...tool_arguments, ...staged_files]
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [tool = '', ...staged_files] = argv
	const command_arguments = build_arguments(tool, staged_files)

	if (command_arguments === undefined) {
		console.error(USAGE)

		return USAGE_ERROR_EXIT_CODE
	}

	const result = await execa(PNPM, command_arguments, { stdio: 'inherit', reject: false })

	return resolve_spawn_exit(PNPM, result)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

const pre_commit_lint = { build_arguments, run, USAGE_ERROR_EXIT_CODE }

export { pre_commit_lint }
