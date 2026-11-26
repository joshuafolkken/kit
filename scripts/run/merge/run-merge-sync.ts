import { issue_cite } from '#scripts/issue/issue-cite'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_transition_guards } from '#scripts/lane/lane-transition-guards'
import { poll } from '#scripts/lib/poll'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_hold } from '#scripts/run/hold/run-hold'
import { run_merge_sync_held } from './run-merge-sync-held'

// The primary checkout's return to the default branch after a merge (`run-merge-steps.ts` →
// `do_merged`).
//
// **Another run's hold keeps the checkout where it is** (joshuafolkken/kit#7716): `main:sync` switches
// the checkout to the default branch and pulls it, so a `fullrun` or `prrun` holding the same tree lost
// its Issue branch and the base its scoped checks were green on. The skip is put on the run's event
// stream; the next sync once the hold is gone — the next merge's, or the holding run's own — catches
// up. **An unreadable record skips too**: it has not established that nothing runs here.

// The check is the transition table's `merge` guard `checkout-not-held-by-another-run`
// (`lane-transition-guards.ts`).

const SYNC_RETRY = { attempts: 3, interval_ms: 5000 }

// **A failed `main:sync` is retried before it ends the run**: a sync right after a merge can fail
// transiently while several lanes merge at once. **The error carries the step's stderr, not its
// stdout**: `main:sync` reports git's refusal on stderr, while stdout carries the wrapper's guard
// statistics. Answers `undefined` once synced, else the last attempt's stderr.
async function retry_sync(): Promise<string | undefined> {
	// `poll_until` answers only whether it succeeded, so the last attempt's stderr is kept here.
	let error_output = ''

	const is_synced = await poll.poll_until(
		async () => {
			const result = await josh_command.josh_run(['main:sync'])

			error_output = result.err ?? ''

			return result.code === 0
		},
		{ ...SYNC_RETRY, sleeper: poll.sleep },
	)

	return is_synced ? undefined : error_output
}

// **A sync a person's uncommitted work refuses holds rather than fails** (joshuafolkken/kit#9034): the
// merge already landed, so it is still counted and recorded, and `backlog:drive` holds launches on the
// marker until the tree is clean or another run holds it (`run-merge-sync-held.ts`). A clean tree's
// failure is no such hold and still ends the run.
async function synced(child: string): Promise<void> {
	const error_output = await retry_sync()

	if (error_output === undefined) return
	if (!(await run_hold.is_tree_dirty())) throw new Error(`main:sync failed: ${error_output}`)

	await run_merge_sync_held.hold(child)
}

async function sync_main(child: string): Promise<void> {
	const reason = await lane_transition_guards.rejection('merge', child)

	if (reason === undefined) {
		await synced(child)

		return
	}

	const text = `${issue_cite.plain_for('program', child)} merged; main:sync skipped on this checkout: ${reason}`

	console.error(text)
	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.NOTE, text)
}

const run_merge_sync = { sync_main }

export { run_merge_sync }
