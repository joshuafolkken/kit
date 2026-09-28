#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { project_checks } from '#scripts/gate/project-checks'
import { ESLINT_CACHE_FLAGS } from '#scripts/josh/josh-command-types'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from '#scripts/josh/josh-composite-arguments'
import { execa } from 'execa'

const COMMAND_NAME = 'format'
const ARGV_OFFSET = 2
const FAIL_EXIT_CODE = 1
const PRETTIER_ARGS = ['exec', 'prettier', '--write', '.'] as const
const ESLINT_FIX_ARGS = ['exec', 'eslint', '.', '--fix', ...ESLINT_CACHE_FLAGS] as const

async function run_step(args: ReadonlyArray<string>, directory: string): Promise<number> {
	const result = await execa('pnpm', args, { cwd: directory, stdio: 'inherit', reject: false })

	return result.exitCode ?? FAIL_EXIT_CODE
}

// prettier first, deliberately: `eslint --fix` exits 1 whenever a non-autofixable error remains, so
// putting it first would mean one unused variable anywhere in the tree stops prettier from running.
// A static project without ESLint is skipped with the same reason `josh lint` prints
// (joshuafolkken/kit#2693).
async function run_format(directory: string): Promise<number> {
	const prettier_exit_code = await run_step(PRETTIER_ARGS, directory)
	if (prettier_exit_code !== 0) return prettier_exit_code
	const reason = project_checks.eslint_skip_reason(directory)

	if (reason !== undefined) {
		console.info(project_checks.skip_notice('eslint', reason))

		return 0
	}

	return await run_step(ESLINT_FIX_ARGS, directory)
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

export { ESLINT_FIX_ARGS, format }
