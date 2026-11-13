#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { project_checks } from '#scripts/gate/project-checks'
import {
	ESLINT_CACHE_FILE,
	ESLINT_CACHE_FLAGS,
	PRETTIER_CACHE_FLAGS,
} from '#scripts/josh/josh-command-types'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from '#scripts/josh/josh-composite-arguments'
import { format_steps } from './format-steps'
import { lint_shard } from './lint-shard'

const COMMAND_NAME = 'format'
const ARGV_OFFSET = 2

function prettier_write_args_of(targets: ReadonlyArray<string>): ReadonlyArray<string> {
	return ['exec', 'prettier', '--write', ...targets, ...PRETTIER_CACHE_FLAGS]
}

const PRETTIER_WRITE_ARGS = prettier_write_args_of([lint_shard.WHOLE_TREE])

// The whole tree as this project formats it (`project_checks.prettier_targets`).
function prettier_write_args(directory: string): ReadonlyArray<string> {
	return prettier_write_args_of(project_checks.prettier_targets(directory, [lint_shard.WHOLE_TREE]))
}

const ESLINT_FIX_ARGS = ['exec', 'eslint', '.', '--fix', ...ESLINT_CACHE_FLAGS] as const

async function run_format(directory: string): Promise<number> {
	return await format_steps.run(
		[
			{ check: 'eslint', args: ESLINT_FIX_ARGS },
			{ check: 'prettier', args: prettier_write_args(directory) },
		],
		ESLINT_CACHE_FILE,
		directory,
	)
}

// The argument refusal survives leaving the `sh -c` composite shape: both tools run over the whole
// tree, so a path passed here would be silently discarded and every file rewritten instead.
async function run(argv: ReadonlyArray<string>, directory: string): Promise<number> {
	if (argv.length > 0) {
		console.error(composite_arguments.format_rejection(COMMAND_NAME, []))

		return USAGE_ERROR_EXIT_CODE
	}

	return await run_format(directory)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET), process.cwd())
}

const format = { run, run_format }

export { ESLINT_FIX_ARGS, format, PRETTIER_WRITE_ARGS }
