import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { main_sync_switch } from '#scripts/git/main-sync-switch'
import { issue_cite } from '#scripts/issue/issue-cite'
import { josh_command } from '#scripts/josh/josh-run'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_transition_guards } from '#scripts/lane/lane-transition-guards'
import { json_value } from '#scripts/lib/json-value'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { z } from 'zod'

// A merge whose `main:sync` a person's uncommitted work in the primary checkout refused
// (joshuafolkken/kit#9034). The marker lives in the shared git directory, so `run:merge` writes it and
// `backlog:drive` — another process — reads it: launches hold on it, never a hand-back that re-wakes
// a judgment session that cannot touch a person's work. **The person is told once**: only the write
// that creates the marker notifies. **It ends without a person**: once another run holds the checkout,
// or the tree is clean and the sync goes through. Script-emitted, so English.

const MARKER_NAME = 'main-sync-held.json'
const SYNC = 'main:sync'
const LOCAL_CHANGES_REFUSAL = /would be overwritten by (?:checkout|merge)/u
const marker_schema = z.object({ child: z.string(), at: z.string() })

type Marker = z.infer<typeof marker_schema>

function marker_path(): string | undefined {
	const common = git_common_directory.repository()

	if (common === undefined) return undefined

	return path.join(common, git_common_directory.STATE_DIRECTORY, MARKER_NAME)
}

function read_marker(target: string): Marker | undefined {
	try {
		return json_value.parse_with(readFileSync(target, 'utf8'), marker_schema)
	} catch {
		return undefined
	}
}

function hold_text(child: string): string {
	return `${issue_cite.plain_for('program', child)} merged; main:sync held — the primary checkout has uncommitted changes`
}

async function notify(text: string): Promise<void> {
	await telegram_notify.warn({
		issue_title: 'main:sync held',
		body: `${text}. Launches wait until it is committed, stashed or held by a run.`,
		recovery: 'pnpm josh run:board',
	})
}

// Puts the hold on record: the run's stream always, the marker and the notice only when it opens.
async function hold(child: string): Promise<void> {
	const text = hold_text(child)
	const target = marker_path()

	console.error(text)
	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.NOTE, text)

	if (target === undefined) return

	mkdirSync(path.dirname(target), { recursive: true })

	if (stamp_file.create_stamp(target, { child, at: new Date().toISOString() })) await notify(text)
}

// **Only a local-changes refusal holds** — git's own "would be overwritten by checkout / merge", for
// tracked and untracked files alike, or `main:sync`'s refusal to switch a branch carrying uncommitted
// work (joshuafolkken/kit#9106). A dirty tree alone is no such refusal: a ledger line `main:sync`
// carries over leaves it dirty, and a transient failure on it still ends the run.
function is_refusal(error_output: string): boolean {
	if (error_output.includes(main_sync_switch.UNCOMMITTED_REFUSAL)) return true

	return LOCAL_CHANGES_REFUSAL.test(error_output)
}

// Whether the hold is over: another run holds the checkout, so no sync is owed here
// (`run-merge-sync.ts`), or the sync goes through. **The sync is retried on every read**, never gated on
// a clean tree: a tree left dirty only by what the sync carries over would otherwise hold forever.
async function is_released(child: string): Promise<boolean> {
	if ((await lane_transition_guards.rejection('merge', child)) !== undefined) return true

	const result = await josh_command.josh_run([SYNC])

	return result.code === 0
}

// The production `sync_held` port of `backlog:drive`: whether launches still hold on the marker,
// clearing it once the hold is over.
async function is_held(): Promise<boolean> {
	const target = marker_path()
	const marker = target === undefined ? undefined : read_marker(target)

	if (target === undefined || marker === undefined) return false
	if (!(await is_released(marker.child))) return true

	stamp_file.remove_stamp(target)

	return false
}

const run_merge_sync_held = { MARKER_NAME, hold, is_held, is_refusal }

export { run_merge_sync_held }
