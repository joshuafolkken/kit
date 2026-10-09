#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { project_checks } from '#scripts/gate/project-checks'
import { ESLINT_CACHE_FILE, ESLINT_CACHE_FLAGS } from '#scripts/josh/josh-command-types'
import { lane_cache_run } from '#scripts/lane/lane-cache-run'
import {
	buffered_process,
	FAIL_EXIT_CODE,
	type BufferedProcessResult,
} from '#scripts/lib/buffered-process'

const PRETTIER_ARGS = ['exec', 'prettier', '--check', '.'] as const
// This — not the `lint:eslint` map entry — is the eslint invocation `josh gate` reaches, so the
// cache flags come from the same constant the ignore rules are asserted against.
// A copy here would keep writing the old location the day that constant
// moves, with every test still green.
const ESLINT_ARGS = ['exec', 'eslint', '.', ...ESLINT_CACHE_FLAGS] as const

async function run_eslint(
	eslint_args: ReadonlyArray<string>,
	cache_file: string,
): Promise<BufferedProcessResult> {
	return await lane_cache_run.run(
		cache_file,
		async () => await buffered_process.run_buffered_process(eslint_args),
	)
}

function write_output(result: BufferedProcessResult): void {
	if (result.output) process.stdout.write(result.output)
}

function skipped(check: string, reason: string): BufferedProcessResult {
	return { output: `${project_checks.skip_notice(check, reason)}\n`, exit_code: 0, elapsed_ms: 0 }
}

async function run_prettier(
	directory: string,
	prettier_args: ReadonlyArray<string>,
): Promise<BufferedProcessResult> {
	const reason = project_checks.prettier_skip_reason(directory)
	if (reason !== undefined) return skipped('prettier', reason)

	return await buffered_process.run_buffered_process(prettier_args)
}

async function run_checked_eslint(
	directory: string,
	eslint_args: ReadonlyArray<string>,
	cache_file: string,
): Promise<BufferedProcessResult> {
	const reason = project_checks.eslint_skip_reason(directory)
	if (reason !== undefined) return skipped('eslint', reason)

	return await run_eslint(eslint_args, cache_file)
}

function lint_exit_code(prettier: BufferedProcessResult, eslint: BufferedProcessResult): number {
	return buffered_process.is_process_failed(prettier) || buffered_process.is_process_failed(eslint)
		? FAIL_EXIT_CODE
		: 0
}

// The two checks are run from here whether they were pointed at the whole tree or at one change's
// files, so `josh lint:related` reaches prettier and eslint through the same buffering, the same
// "one failure does not abort the other" reading, and the same exit code —
// and through the same basic-project skip, so a narrowed run never reaches a tool the whole-tree
// run would have skipped. The skip reasons answer nothing for a full
// project, so the one path serves both profiles.
async function run_lint_checks(
	prettier_args: ReadonlyArray<string>,
	eslint_args: ReadonlyArray<string>,
	eslint_cache_file: string = ESLINT_CACHE_FILE,
): Promise<number> {
	const directory = process.cwd()
	const [prettier, eslint] = await Promise.all([
		run_prettier(directory, prettier_args),
		run_checked_eslint(directory, eslint_args, eslint_cache_file),
	])

	write_output(prettier)
	write_output(eslint)

	return lint_exit_code(prettier, eslint)
}

async function run_lint_parallel_checks(): Promise<number> {
	return await run_lint_checks(PRETTIER_ARGS, ESLINT_ARGS)
}

// `process.exitCode` rather than `process.exit()`: both reports are buffered and written here in
// one go, and `process.exit()` truncates a piped stdout at its buffer size — which is exactly how
// this command is read when `josh gate` runs it as one of four concurrent checks. Setting the code
// lets the writes drain and the process end on its own, which it can, since both children have
// already exited by here.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_lint_parallel_checks()
}

const lint_parallel = { run_lint_checks, run_lint_parallel_checks }

export { ESLINT_ARGS, lint_parallel }
