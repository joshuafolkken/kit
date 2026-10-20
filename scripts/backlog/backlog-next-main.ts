#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { backlog_next } from './backlog-next'

// The `josh backlog:next` entry, kept apart from `backlog-next.ts` because other modules import that
// one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
//
// `process.exitCode` rather than `process.exit()`, for the reason `auto-ok:next` records: the whole
// contract is `answers=$(pnpm josh backlog:next)`, and exiting outright can cut the pipe before it
// has drained.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await backlog_next.run(process.argv.slice(ARGV_OFFSET))
}
