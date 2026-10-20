#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { josh_environment_file } from '#scripts/josh/josh-environment-file'
import { epic_next } from './epic-next'

// The `josh epic:next` entry, kept apart from `epic-next.ts` because other modules import that one: a
// bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
//
// `.env` is read here rather than through the dispatcher's `tsx_arguments`: declaring any would
// disqualify this command from in-process dispatch, and an unattended `epicrun` asks it every sixty
// seconds for the whole life of a run (`josh-environment-file.ts` records the measurement). Inside the
// guard, so a developer's own `.env` cannot decide what the unit tests see.
//
// `process.exitCode` rather than `process.exit()`, for the reason `scripts/cost-runtime/cost-main.ts`
// records: the answer goes to standard output and a write to a pipe is asynchronous on macOS, so
// exiting can tear the process down before it drains. This command's contract is
// `answer=$(pnpm josh epic:next <E>)`, which is exactly that pipe.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	josh_environment_file.load_environment_file()
	process.exitCode = await epic_next.run(process.argv.slice(ARGV_OFFSET))
}
