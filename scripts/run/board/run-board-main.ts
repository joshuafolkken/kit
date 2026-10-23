#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_board_cli } from './run-board-cli'

// The `josh run:board` entry, kept apart from `run-board-cli.ts` because other modules import that
// one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await run_board_cli.run(process.argv.slice(ARGV_OFFSET))
}
