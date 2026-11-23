#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { check_reuse } from './check-reuse'
import { gate_command } from './gate-command'
import { gate_owner_watch } from './gate-owner-watch'
import { gate_worktree_lock } from './gate-worktree-lock'

// The `josh gate` entry, kept apart from `gate-command.ts` and `verification-gate.ts` because other
// modules import those: a bundle is one file, so a main guard there would fire for every command that
// carries it (joshuafolkken/kit#4186).
//
// `process.exitCode` rather than `process.exit()`: the gate's output is buffered per step and
// written all at once, and `process.exit()` truncates a piped stdout at its buffer size — the
// summary, written last, is the first thing lost. Setting the code lets the writes drain and the
// process end on its own, which it can, since every child has already exited by here.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const extra_arguments = process.argv.slice(changed_file_scope.ARGV_START)

	// A gate whose owner died ends with its checks rather than running on unread (`gate-owner-watch.ts`).
	gate_owner_watch.start()

	const ledger_path = await lane_ledger_write.target()

	process.exitCode = await gate_worktree_lock.run_locked(
		async () =>
			await gate_command.run_gate_command(extra_arguments, {
				ledger_path,
				check_records: check_reuse.DEFAULT_RECORDS,
			}),
	)
}
