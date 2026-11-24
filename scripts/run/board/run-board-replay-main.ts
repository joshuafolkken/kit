#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_board_cli } from './run-board-cli'
import { run_board_replay } from './run-board-replay'

// The `josh board:replay` entry, kept apart from `run-board-replay.ts` because `board:compare` imports
// that one (joshuafolkken/kit#8754): a main guard there would fire for every command that carries it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await run_board_replay.run(
		process.argv.slice(ARGV_OFFSET),
		run_board_cli.live_ports(false),
	)
}
