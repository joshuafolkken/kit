import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { hook_decision } from '#scripts/josh/hook-decision'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { step_zero_notice } from './step-zero-notice'

// **A consultation session's shell is judged by what it left in the tree, not by its text**
// (joshuafolkken/kit#6589). Before a `Bash` call the dirty runtime files and their content hashes are
// stamped; after it, any runtime file whose hash moved is copied under `.josh/tmp/bash-revert/` and
// put back — a tracked one from `HEAD`, an untracked one removed — and the session is told which
// paths it may not write. A session that can
// implement is never stamped nor reverted, and a path outside the runtime set (`.josh/`, a doc) is
// left as the shell wrote it.

const STAMP_PREFIX = 'josh-bash-revert-'
const UNTRACKED = '??'
const ABSENT = 'absent'
const STATUS_WIDTH = 3
// The run's own records (`.josh/observations/`, `.josh/metrics-accepted/`), which a consultation
// session's operations append to, whatever their extension.
const OPERATIONAL_RECORDS = '.josh/'
const BACKUP_DIRECTORY = '.josh/tmp/bash-revert'
const snapshot_schema = z.record(z.string(), z.string())

type Snapshot = Record<string, string>

// `revert` holds the dirty entries clean before the call; `keep` the files dirty before it.
interface Moved {
	revert: Array<string>
	keep: Array<string>
}

const HANDOFF = 'This shell wrote runtime files; hand implementation to a worker lane.'

function content_hash(file: string): string {
	return existsSync(file) ? stamp_file.digest(readFileSync(file)) : ABSENT
}

// `-z` and `--no-renames`: one `XY path` per entry, whatever the path holds. `run`, not `read`: a
// trim would take the first entry's leading ` ` status column with it.
function dirty_entries(root: string): Array<string> {
	const status = git_spawn_sync.run(
		['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'],
		{ cwd: root },
	)
	const entries = status.exit_code === 0 ? status.stdout.split('\0') : []

	// A trailing `/` is an untracked nested repository, a directory no hash reads.
	return entries.filter((entry) => entry.length > STATUS_WIDTH && !entry.endsWith('/'))
}

function is_guarded_file(file: string, root: string): boolean {
	return !file.startsWith(OPERATIONAL_RECORDS) && step_zero_notice.is_runtime_file(file, root)
}

// The runtime files the tree has dirty, each with its content hash.
function snapshot(root: string, entries: Array<string> = dirty_entries(root)): Snapshot {
	const runtime = entries
		.map((entry) => entry.slice(STATUS_WIDTH))
		.filter((file) => is_guarded_file(file, root))

	return Object.fromEntries(runtime.map((file) => [file, content_hash(path.join(root, file))]))
}

// The transcript of a consultation session's `Bash` call, the only call this guards.
function guarded_transcript(raw_payload: string): string | undefined {
	if (agent_session_role.can_implement()) return undefined

	const payload = hook_decision.parse_hook_payload(raw_payload)

	return payload?.tool_name === 'Bash' ? payload.transcript_path : undefined
}

function stamp(raw_payload: string, root: string = process.cwd()): void {
	const transcript = guarded_transcript(raw_payload)

	if (transcript === undefined) return

	const target = stamp_file.stamp_path(STAMP_PREFIX, transcript)

	// A failed write leaves no own record (`write_text_stamp` unlinks first), so the revert does nothing.
	try {
		stamp_file.write_text_stamp(target, JSON.stringify(snapshot(root)))
	} catch {
		// Nothing to revert against is the safe answer.
	}
}

// No stamp means the state before the call is unknown, and nothing is reverted against it.
function stamped(transcript: string): Snapshot | undefined {
	const text = stamp_file.read_stamp_text(stamp_file.stamp_path(STAMP_PREFIX, transcript))

	return text === undefined ? undefined : json_value.parse_with(text, snapshot_schema)
}

function entry_file(entry: string): string {
	return entry.slice(STATUS_WIDTH)
}

// The dirty entries whose runtime file the guarded call wrote, created or deleted: one clean before
// the call is put back, one already dirty is only named — `HEAD` would discard the edit it carried.
function moved_entries(raw_payload: string, root: string): Moved {
	const transcript = guarded_transcript(raw_payload)
	const before = transcript === undefined ? undefined : stamped(transcript)

	if (before === undefined) return { revert: [], keep: [] }

	const entries = dirty_entries(root)
	const after = snapshot(root, entries)
	const moved = entries.filter((entry) => {
		const hash = after[entry_file(entry)]

		return hash !== undefined && hash !== before[entry_file(entry)]
	})

	return {
		revert: moved.filter((entry) => !Object.hasOwn(before, entry_file(entry))),
		keep: moved.map((entry) => entry_file(entry)).filter((file) => Object.hasOwn(before, file)),
	}
}

function restore(file: string, root: string): void {
	const restored = git_spawn_sync.run(['checkout', 'HEAD', '--', file], { cwd: root })

	if (restored.exit_code !== 0) git_spawn_sync.run(['rm', '-q', '-f', '--', file], { cwd: root })
}

// The change may be a person's or another session's rather than this shell's, so its content is
// copied under `backup` before the revert discards it.
function revert_file(entry: string, root: string, backup: string): void {
	const file = entry_file(entry)
	const source = path.join(root, file)

	if (existsSync(source)) {
		mkdirSync(path.dirname(path.join(backup, file)), { recursive: true })
		copyFileSync(source, path.join(backup, file))
	}

	if (entry.startsWith(UNTRACKED)) rmSync(source, { force: true })
	else restore(file, root)
}

function block_reason(moved: Moved, backup: string): string {
	const parts = [HANDOFF]

	if (moved.revert.length > 0) {
		parts.push(
			`Reverted: ${moved.revert.map((entry) => entry_file(entry)).join(', ')}.`,
			`Their content before the revert: ${backup}/.`,
		)
	}

	if (moved.keep.length > 0) {
		parts.push(`Changed, kept as dirty before the call: ${moved.keep.join(', ')}.`)
	}

	return parts.join(' ')
}

// The block a `PostToolUse` hook answers with, naming the moved paths, or nothing to say.
function revert(raw_payload: string, root: string = process.cwd()): string | undefined {
	const moved = moved_entries(raw_payload, root)

	if (moved.revert.length + moved.keep.length === 0) return undefined

	const backup = path.join(BACKUP_DIRECTORY, new Date().toISOString().replaceAll(':', '-'))

	for (const entry of moved.revert) revert_file(entry, root, path.join(root, backup))

	return JSON.stringify({ decision: 'block', reason: block_reason(moved, backup) })
}

function is_shell(raw_payload: string): boolean {
	return hook_decision.parse_hook_payload(raw_payload)?.tool_name === 'Bash'
}

function respond(raw_payload: string): void {
	const envelope = revert(raw_payload)

	if (envelope !== undefined) process.stdout.write(`${envelope}\n`)
}

const bash_revert = { is_shell, respond, revert, stamp }

export { bash_revert }
