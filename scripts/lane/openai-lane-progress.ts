import { createHash } from 'node:crypto'
import { git_spawn_sync, type GitSyncOptions } from '#scripts/git/git-spawn-sync'
import { session_cite } from '#scripts/issue/session-cite'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// Consecutive generations that cut without changing the worktree before the supervisor stops relaunching.
// A resumed child that cuts before its first edit would otherwise be relaunched without end (#7608).
const NO_PROGRESS_CUT_LIMIT = 3
const NO_PROGRESS_REASON = 'no-progress cut'

// The untracked paths with their content hashes: `diff HEAD` does not see an edit to an untracked file.
function untracked_state(options: GitSyncOptions): string {
	const listed = git_spawn_sync.read(['ls-files', '--others', '--exclude-standard'], options) ?? ''
	if (listed === '') return ''
	const paths = listed.split('\n')
	const hashes = git_spawn_sync.read(['hash-object', '--', ...paths], options) ?? ''

	return `${listed}\0${hashes}`
}

// The worktree state a generation leaves behind: HEAD, the diff against it and the untracked paths.
// Undefined outside a git worktree, where progress cannot be told and is assumed.
function fingerprint(directory: string): string | undefined {
	const options = git_spawn_sync.located(directory)
	const head = git_spawn_sync.read(['rev-parse', 'HEAD'], options)
	if (head === undefined) return undefined
	const diff = git_spawn_sync.read(['diff', 'HEAD', '--binary'], options) ?? ''

	return createHash('sha256')
		.update([head, diff, untracked_state(options)].join('\0'))
		.digest('hex')
}

// The consecutive no-progress cuts once a generation that started at `before` cut at `after`.
function next_idle_cuts(
	idle_cuts: number,
	before: string | undefined,
	after: string | undefined,
): number {
	if (before === undefined || before !== after) return 0

	return idle_cuts + 1
}

function is_exhausted(idle_cuts: number): boolean {
	return idle_cuts >= NO_PROGRESS_CUT_LIMIT
}

async function record_stop(issue: string, idle_cuts: number): Promise<void> {
	const text = `OpenAI supervisor ${session_cite.issue(issue)}: ${NO_PROGRESS_REASON} — ${String(idle_cuts)} consecutive generations cut without progress; stopping with work and cut preserved`

	console.error(text)
	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.NOTE, text)
}

const openai_lane_progress = {
	NO_PROGRESS_CUT_LIMIT,
	NO_PROGRESS_REASON,
	fingerprint,
	is_exhausted,
	next_idle_cuts,
	record_stop,
}

export { openai_lane_progress }
