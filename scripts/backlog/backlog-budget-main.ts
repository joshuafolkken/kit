#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { backlog_budget_cli } from './backlog-budget-cli'

// The `josh backlog:budget` entry, kept apart from `backlog-budget-cli.ts` because other modules
// import that one: a bundle is one file, so a main guard there would fire for every command that
// carries it (joshuafolkken/kit#4186).
//
// `process.exitCode` rather than `process.exit()`, for the reason `backlog:next` records: the whole
// contract is `answer=$(pnpm josh backlog:budget …)`, and exiting outright can cut the pipe before it
// has drained.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = backlog_budget_cli.run(process.argv.slice(ARGV_OFFSET))
}
