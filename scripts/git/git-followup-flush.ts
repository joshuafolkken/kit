import { observation_ledger } from '#scripts/observations/observation-ledger'
import { observations_flush } from '#scripts/observations/observations-flush'
import { git_command } from './git-command'
import { git_followup_cleanup } from './git-followup-cleanup'
import { main_sync } from './main-sync'

// The observation ledger's only commit path is `pnpm josh observations:flush`, and until now no
// command's procedure called it (joshuafolkken/kit#1810). The ledger is excluded from ordinary
// staging (joshuafolkken/kit#1756), so an appended line stayed in the working tree until a person
// remembered to flush it — the same "a run that had to remember is the run that forgets" defect the
// staging side was built to avoid, left standing on the commit side. This wires the flush into
// `pnpm josh followup`, the one step that knows the merge has landed.
//
// **It runs before the working-tree hold is released** (`scripts-ai/git-followup-finish.ts`, whose
// `finish()` runs after `git_pr_followup.run()` returns), because a flush switches branches, and a
// hold released first would let another run grab the tree mid-switch.

const MAIN_SYNC_SUCCESS = 0
const FLUSH_RECOVERY = 'pnpm josh observations:flush'
const SYNC_FAILURE_MESSAGE =
	'Could not return to the default branch to flush the observation ledger; `pnpm josh ms` printed the reason above.'

// `observations_flush.flush` requires the default branch, so the checkout is returned to it first.
// `main_sync.run` catches its own errors and answers with an exit code rather than throwing, so a
// checkout it could not move is turned into the throw the guarded step below reports.
async function sync_and_flush(): Promise<void> {
	if ((await main_sync.run([])) !== MAIN_SYNC_SUCCESS) throw new Error(SYNC_FAILURE_MESSAGE)

	console.info(await observations_flush.flush(new Date()))
}

// **Short-circuits when the ledger holds no pending append.** That is every run that recorded no
// observation and every lane/worktree child (a delegated child never appends — SKILL.md §2i), so the
// ordinary run pays nothing and never reaches `main_sync`, which refuses inside a linked work tree
// anyway. Guarded like its sibling tail steps (joshuafolkken/kit#1539): past the merge a flush
// failure is reported, never allowed to take the merge, the epic close and the hold release with it.
async function flush_ledger_step(should_merge: boolean): Promise<void> {
	if (!should_merge) return
	if (!observation_ledger.has_pending_append(await git_command.status())) return

	// `should_merge` is always true past the early return; it is passed on as `run_guarded_step`'s
	// guard flag rather than a literal `true` so this step stays identical to its sibling tail steps —
	// hardcoding `true` would turn the guard on for a `--no-merge` run if the early return were ever
	// dropped (the trap `in_progress_step` warns of).
	await git_followup_cleanup.run_guarded_step(should_merge, {
		label: 'The observation ledger flush',
		recovery: FLUSH_RECOVERY,
		run: sync_and_flush,
	})
}

const git_followup_flush = { flush_ledger_step }

export { git_followup_flush }
