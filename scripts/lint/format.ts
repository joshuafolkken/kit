#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { project_checks } from '#scripts/gate/project-checks'
import {
	ESLINT_CACHE_FILE,
	ESLINT_CACHE_FLAGS,
	PRETTIER_CACHE_FLAGS,
} from '#scripts/josh/josh-command-types'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from '#scripts/josh/josh-composite-arguments'
import { execa } from 'execa'
import { eslint_cache_dependencies } from './eslint-cache-dependencies'
import { eslint_heap } from './eslint-heap'
import { lint_shard } from './lint-shard'

const COMMAND_NAME = 'format'
const ARGV_OFFSET = 2
const FAIL_EXIT_CODE = 1

function prettier_write_args_of(targets: ReadonlyArray<string>): ReadonlyArray<string> {
	return ['exec', 'prettier', '--write', ...targets, ...PRETTIER_CACHE_FLAGS]
}

const PRETTIER_WRITE_ARGS = prettier_write_args_of([lint_shard.WHOLE_TREE])

// The whole tree as this project formats it (`project_checks.prettier_targets`).
function prettier_write_args(directory: string): ReadonlyArray<string> {
	return prettier_write_args_of(project_checks.prettier_targets(directory, [lint_shard.WHOLE_TREE]))
}

const ESLINT_FIX_ARGS = ['exec', 'eslint', '.', '--fix', ...ESLINT_CACHE_FLAGS] as const

async function run_step(
	check: string,
	args: ReadonlyArray<string>,
	directory: string,
): Promise<number> {
	const environment = check === 'eslint' ? { env: eslint_heap.environment(), extendEnv: false } : {}
	const result = await execa('pnpm', args, {
		cwd: directory,
		stdio: 'inherit',
		reject: false,
		...environment,
	})

	return result.exitCode ?? FAIL_EXIT_CODE
}

// prettier first, deliberately: `eslint --fix` exits 1 whenever a non-autofixable error remains, so
// putting it first would mean one unused variable anywhere in the tree stops prettier from running.
// A basic project without Prettier or ESLint is skipped with the same reason `josh lint` prints.
async function run_unless_skipped(
	check: string,
	reason: string | undefined,
	args: ReadonlyArray<string>,
	directory: string,
): Promise<number> {
	if (reason === undefined) return await run_step(check, args, directory)
	console.info(project_checks.skip_notice(check, reason))

	return 0
}

async function run_format(directory: string): Promise<number> {
	const prettier_reason = project_checks.prettier_skip_reason(directory)
	const prettier_exit_code = await run_unless_skipped(
		'prettier',
		prettier_reason,
		prettier_write_args(directory),
		directory,
	)
	if (prettier_exit_code !== 0) return prettier_exit_code
	const eslint_reason = project_checks.eslint_skip_reason(directory)

	return await eslint_cache_dependencies.guard(
		ESLINT_CACHE_FILE,
		async () => await run_unless_skipped('eslint', eslint_reason, ESLINT_FIX_ARGS, directory),
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
