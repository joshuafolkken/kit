#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_park } from '#scripts/rules/lane-park'
import { run_hold_cli } from './run-hold-cli'

// Internal endings call run_hold_cli directly; only the agent's direct release must park first.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv[0] === '--release' && argv[1] !== '--force' && lane_park.is_unparked_child()) {
		console.error(
			`run:release: an unparked lane child must use pnpm josh run:park ${lane_child_marker.marked_issue() ?? '<N>'} --body-file <path> before stopping for a decision; the hold was kept.`,
		)

		return 1
	}

	return await run_hold_cli.run(argv)
}

// The `josh run:hold` and `josh run:release` entry, kept apart from `run-hold-cli.ts` because other
// modules import that one: a bundle is one file, so a main guard there would fire for every command
// that carries it (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}
