#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { TS_CACHE_FLAGS } from '#scripts/josh/josh-command-types'
import { execa } from 'execa'
import { project_checks } from './project-checks'

// `josh check` — the project-wide TypeScript check. It used to be a bare `tsc --noEmit` shell entry,
// so on a basic project with nothing to type-check it failed with `Command "tsc" not found` while
// the gate, which asks `type_check_skip_reason` first, skipped the same step.
// Both now read that one decision.

const ARGV_OFFSET = 2
const FAIL_EXIT_CODE = 1
const TSC_ARGS = ['exec', 'tsc', '--noEmit', ...TS_CACHE_FLAGS] as const

async function run_type_check(
	command_arguments: ReadonlyArray<string>,
	directory: string,
): Promise<number> {
	const reason = project_checks.type_check_skip_reason(directory)

	if (reason !== undefined) {
		console.info(project_checks.skip_notice('check', reason))

		return 0
	}

	const result = await execa('pnpm', [...TSC_ARGS, ...command_arguments], {
		cwd: directory,
		stdio: 'inherit',
		reject: false,
	})

	return result.exitCode ?? FAIL_EXIT_CODE
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_type_check(process.argv.slice(ARGV_OFFSET), process.cwd())
}

const type_check_command = { run_type_check }

export { TSC_ARGS, type_check_command }
