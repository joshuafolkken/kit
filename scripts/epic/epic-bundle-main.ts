#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { epic_bundle_cli } from './epic-bundle-cli'

// The `josh epic:bundle` entry, kept apart from `epic-bundle-cli.ts` because other modules import that
// one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
//
// `process.exitCode` rather than `process.exit()`: the answer goes to standard output and a write to
// a pipe is asynchronous on macOS, so exiting can tear the process down before it drains. This
// command's answer is what a workflow reads and acts on, which is exactly that pipe. The same shape
// is in `scripts/cost-runtime/cost-cli.ts`, which met the truncation first.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await epic_bundle_cli.run(process.argv.slice(ARGV_OFFSET))
}
