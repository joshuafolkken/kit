#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { core_budget } from '#scripts/gate/core-budget'
import {
	CSPELL_COMMIT_CACHE_FLAGS,
	ESLINT_COMMIT_CACHE_FILE,
	ESLINT_COMMIT_CACHE_FLAGS,
	PRETTIER_CACHE_FLAGS,
} from '#scripts/josh/josh-command-types'
import { FAIL_EXIT_CODE } from '#scripts/lib/buffered-process'
import { resolve_spawn_exit } from '#scripts/lib/spawn-exit'
import { cross_file_recheck, type CrossFileRecheckOptions } from '#scripts/lint/cross-file-recheck'
import { eslint_daemon } from '#scripts/lint/eslint-daemon'
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
const ESLINT = 'eslint'
// eslint's numeric "error" severity, the one rule severity `--quiet` keeps.
const ERROR_SEVERITY = 2

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

// `--quiet` runs only the rules set to "error"; the Node API spells that as a rule filter, so the
// re-reading asks the question the hook's run asked.
function is_error_rule(rule: { severity: number }): boolean {
	return rule.severity === ERROR_SEVERITY
}

// What re-reading a cached cross-file report (`cross-file-recheck.ts`) needs to ask the hook's run
// again: the hook's own cache file and the staged files (joshuafolkken/kit#4407).
function recheck_options(staged_files: ReadonlyArray<string>): CrossFileRecheckOptions {
	return {
		cache_file: ESLINT_COMMIT_CACHE_FILE,
		patterns: staged_files,
		errors_only: true,
		eslint_options: { ruleFilter: is_error_rule },
	}
}

// eslint goes through the lane's warm daemon when one is reachable (joshuafolkken/kit#4358): the same
// argument list and the same cache file, without paying the config and plugin load per commit. It
// runs inside the tool's core-budget reservation like the cold route does.
//
// Its red report is re-read before it is printed (joshuafolkken/kit#4407): a merge or checkout can
// change only the files a staged file imports, and the content cache keeps the staged file's verdict.
async function run_eslint(
	command_arguments: ReadonlyArray<string>,
	staged_files: ReadonlyArray<string>,
): Promise<number> {
	const result = await eslint_daemon.run_or_cold(command_arguments)
	const verified = await cross_file_recheck.verify(result, recheck_options(staged_files))
	if (verified.output !== '') process.stdout.write(verified.output)

	return verified.exit_code ?? FAIL_EXIT_CODE
}

async function run_tool(command_arguments: ReadonlyArray<string>): Promise<number> {
	const result = await execa(PNPM, command_arguments, { stdio: 'inherit', reject: false })

	return resolve_spawn_exit(PNPM, result)
}

async function run_reserved(tool: string, staged_files: ReadonlyArray<string>): Promise<number> {
	const command_arguments = build_arguments(tool, staged_files) ?? []
	if (tool === ESLINT) return await run_eslint(command_arguments, staged_files)

	return await run_tool(command_arguments)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [tool = '', ...staged_files] = argv
	const budget = TOOL_BUDGETS[tool]

	if (budget === undefined) {
		console.error(USAGE)

		return USAGE_ERROR_EXIT_CODE
	}

	return await core_budget.with_command_reservation(
		core_budget.CORE_WEIGHTS[budget],
		async () => await run_reserved(tool, staged_files),
		{ memory_mb: core_budget.MEMORY_MB[budget], command: `pre-commit ${tool}` },
	)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

const pre_commit_lint = { build_arguments, recheck_options, run, USAGE_ERROR_EXIT_CODE }

export { pre_commit_lint }
