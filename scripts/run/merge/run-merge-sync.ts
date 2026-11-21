import { issue_cite } from '#scripts/issue/issue-cite'
import { josh_command } from '#scripts/josh/josh-run'
import { poll } from '#scripts/lib/poll'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_hold, type HoldRead } from '#scripts/run/hold/run-hold'

// The primary checkout's return to the default branch after a merge (`run-merge-steps.ts` →
// `do_merged`).
//
// **Another run's hold keeps the checkout where it is** (joshuafolkken/kit#7716): `main:sync` switches
// the checkout to the default branch and pulls it, so a `fullrun` or `prrun` holding the same tree lost
// its Issue branch and the base its scoped checks were green on. The skip is put on the run's event
// stream; the next sync once the hold is gone — the next merge's, or the holding run's own — catches
// up. **An unreadable record skips too**: it has not established that nothing runs here.

const SYNC_RETRY = { attempts: 3, interval_ms: 5000 }

async function read_tree_hold(): Promise<HoldRead> {
	const directory = await run_hold.worktree_directory()

	if (directory === undefined) return { kind: 'free' }

	return run_hold.read_hold(run_hold.hold_path(directory))
}

// Why the sync must not run here, or `undefined` where it may. The merged child's own hold — a child
// run outside a lane — is not another run's.
function skip_reason(read: HoldRead, child: string): string | undefined {
	if (read.kind === 'unreadable') return 'its run hold record is unreadable'
	if (read.kind !== 'held' || run_hold.is_own_hold(read.hold, child)) return undefined

	return `it is held by ${run_hold.describe_holder(read.hold)}`
}

// **A failed `main:sync` is retried before it ends the run**: a sync right after a merge can fail
// transiently while several lanes merge at once. **The error carries the step's stderr, not its
// stdout**: `main:sync` reports git's refusal on stderr, while stdout carries the wrapper's guard
// statistics.
async function retry_sync(): Promise<void> {
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

	if (!is_synced) throw new Error(`main:sync failed: ${error_output}`)
}

async function sync_main(child: string): Promise<void> {
	const reason = skip_reason(await read_tree_hold(), child)

	if (reason === undefined) {
		await retry_sync()

		return
	}

	const text = `${issue_cite.plain_for('program', child)} merged; main:sync skipped on this checkout: ${reason}`

	console.error(text)
	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.NOTE, text)
}

const run_merge_sync = { sync_main }

export { run_merge_sync }
