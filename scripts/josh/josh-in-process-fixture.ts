#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'

// Loaded by `josh-in-process.test.ts` through the same dynamic import the dispatcher uses, so the
// test exercises the real mechanism rather than a stand-in: the argv replacement is what makes the
// guard below match, and the exit code set here is what `run_in_process` has to answer with.
const EXIT_CODE_ARGUMENT_INDEX = 2

function main(argv: ReadonlyArray<string>): void {
	const requested = argv[EXIT_CODE_ARGUMENT_INDEX]

	if (requested !== undefined) process.exitCode = Number(requested)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv)

export { main }
