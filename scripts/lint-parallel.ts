#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { buffered_process, FAIL_EXIT_CODE } from './buffered-process'
import { ESLINT_CACHE_FLAGS } from './josh/josh-command-types'

const PRETTIER_ARGS = ['exec', 'prettier', '--check', '.'] as const
// This — not the `lint:eslint` map entry — is the eslint invocation `josh gate` reaches, so the
// cache flags come from the same constant the ignore rules are asserted against
// (joshuafolkken/kit#1256). A copy here would keep writing the old location the day that constant
// moves, with every test still green.
const ESLINT_ARGS = ['exec', 'eslint', '.', ...ESLINT_CACHE_FLAGS] as const

async function run_lint_parallel_checks(): Promise<number> {
	const [prettier, eslint] = await Promise.all([
		buffered_process.run_buffered_process(PRETTIER_ARGS),
		buffered_process.run_buffered_process(ESLINT_ARGS),
	])

	if (prettier.output) process.stdout.write(prettier.output)
	if (eslint.output) process.stdout.write(eslint.output)

	return buffered_process.is_process_failed(prettier) || buffered_process.is_process_failed(eslint)
		? FAIL_EXIT_CODE
		: 0
}

// `process.exitCode` rather than `process.exit()`: both reports are buffered and written here in
// one go, and `process.exit()` truncates a piped stdout at its buffer size — which is exactly how
// this command is read when `josh gate` runs it as one of four concurrent checks. Setting the code
// lets the writes drain and the process end on its own, which it can, since both children have
// already exited by here.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_lint_parallel_checks()
}

export { ESLINT_ARGS, run_lint_parallel_checks }
