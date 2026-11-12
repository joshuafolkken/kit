import { run_hold, type HoldRead, type RunHold } from './run-hold'

// What stops a claim, and `undefined` when nothing does. **An unreadable record stops it**: the run
// that wrote it is the one whose uncommitted work would be trampled, so a record that cannot be
// parsed is never read as an idle tree. **And an expired record still stops it while the tree is
// dirty** — that is a run which stopped for a person, and the work is right there in the tree.
// **A live record stops every claim but its own run's.**
function held_block(hold: RunHold, issue: string): string | undefined {
	return run_hold.is_reentry(hold, issue) ? undefined : run_hold.held_message(hold)
}

// An expired record of the claimant's own issue that no stop marked is the earlier run of the same work —
// a child killed and re-dispatched into its lane — so the claim adopts it with the work it left. A
// stopped `halfrun` or `prrun` keeps its own adopt path.
function is_own_unstopped(hold: RunHold, issue: string): boolean {
	return run_hold.is_reentry(hold, issue) && !run_hold.is_stop_marked(hold)
}

async function stale_block(hold: RunHold, issue: string): Promise<string | undefined> {
	if (is_own_unstopped(hold, issue)) return undefined

	return (await run_hold.is_tree_dirty()) ? run_hold.uncommitted_message(hold) : undefined
}

async function blocking_message(read: HoldRead, issue: string): Promise<string | undefined> {
	if (read.kind === 'held') return held_block(read.hold, issue)

	if (read.kind === 'unreadable') return run_hold.unreadable_message()

	return read.kind === 'stale' ? await stale_block(read.hold, issue) : undefined
}

const run_hold_block = { blocking_message }

export { run_hold_block }
