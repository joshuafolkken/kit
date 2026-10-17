#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { core_budget } from '#scripts/gate/core-budget'
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

// **Each tool claims its place in the core budget** (joshuafolkken/kit#3944): lefthook starts the three
// in parallel, and off the ledger every other lane's admission saw them only as foreign load. Each is
// one process over the staged files — eslint over 40 of them took 16.9s of CPU over 14.0s of wall at
// 1,225 MB, the one-process shape the whole-tree scan's weight already names.
// The key is the one `CORE_WEIGHTS` and `MEMORY_MB` both declare the tool under.
const TOOL_BUDGETS: Readonly<Record<string, 'spell_check' | 'format' | 'eslint_scan'>> = {
	cspell: 'spell_check',
	prettier: 'format',
	eslint: 'eslint_scan',
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

async function run_tool(command_arguments: ReadonlyArray<string>): Promise<number> {
	const result = await execa(PNPM, command_arguments, { stdio: 'inherit', reject: false })

	return resolve_spawn_exit(PNPM, result)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [tool = '', ...staged_files] = argv
	const command_arguments = build_arguments(tool, staged_files)
	const budget = TOOL_BUDGETS[tool]

	if (command_arguments === undefined || budget === undefined) {
		console.error(USAGE)

		return USAGE_ERROR_EXIT_CODE
	}

	return await core_budget.with_command_reservation(
		core_budget.CORE_WEIGHTS[budget],
		async () => await run_tool(command_arguments),
		{ memory_mb: core_budget.MEMORY_MB[budget], command: `pre-commit ${tool}` },
	)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

const pre_commit_lint = { build_arguments, run, USAGE_ERROR_EXIT_CODE }

export { pre_commit_lint }
