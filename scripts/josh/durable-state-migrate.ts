import { constants, copyFileSync, lstatSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'

// The two upkeep jobs of the durable run-state directory (`durable-state.ts`), each run at most once
// per process per directory rather than on every record lookup.
//
// **A legacy record is copied once per directory.** A run that is going when
// this lands wrote its records to `/tmp`, and reading only the new place would end it as a reboot
// did. Copying on every lookup instead brought back a record a run removed on purpose — an ended
// carry, a stopped launch, a failed ship's result — from the `/tmp` original. The original is left
// in place: a lane or parent still on the code before this change reads `/tmp` until it merges main.
// A copy rather than a rename because `/tmp` is often another filesystem. A record an old-code
// process writes to `/tmp` after the copy is not picked up.
//
// **A log not written for two weeks is removed.** `/tmp` used to clear them on every boot; the common
// git directory never does, and a log is the only record here that grows without an owner ending it.

const COPIED_MARKER = '.legacy-copied'
const MARKER_MODE = 0o600
const LOG_RETENTION_DAYS = 14
const DAY_MS = 86_400_000
const LOG_SUFFIX = '.log'
// What a record is. A lock or a staged write beside a record carries its prefix but means nothing
// past the process that made it.
const RECORD_SUFFIXES = ['.json', '.jsonl', LOG_SUFFIX] as const

function is_record_name(name: string, prefixes: ReadonlyArray<string>): boolean {
	const has_prefix = prefixes.some((prefix) => name.startsWith(prefix))

	return has_prefix && RECORD_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

function list_names(directory: string): Array<string> {
	try {
		return readdirSync(directory)
	} catch {
		return []
	}
}

function copy_record(from: string, to: string): void {
	try {
		if (!stamp_file.is_own_regular_file(from)) return

		copyFileSync(from, to, constants.COPYFILE_EXCL)
	} catch {
		// Another process wrote it first, or the copy failed; either way nothing is overwritten.
	}
}

function copy_legacy(from: string, to: string, prefixes: ReadonlyArray<string>): void {
	if (from === to) return

	for (const name of list_names(from)) {
		if (is_record_name(name, prefixes)) copy_record(path.join(from, name), path.join(to, name))
	}
}

// The marker is created exclusively, so one process wins the copy. A marker rather than whether
// `mkdirSync` made the directory: a lane on this code can create the shared directory before the run
// that owns the `/tmp` records switches over, and that run still needs its copy.
function claim_copy(directory: string): boolean {
	try {
		writeFileSync(path.join(directory, COPIED_MARKER), '', { flag: 'wx', mode: MARKER_MODE })

		return true
	} catch {
		return false
	}
}

function copy_once(from: string, to: string, prefixes: ReadonlyArray<string>): void {
	if (claim_copy(to)) copy_legacy(from, to, prefixes)
}

function is_stale(target: string, now_ms: number): boolean {
	const age_ms = now_ms - lstatSync(target).mtimeMs

	return age_ms > LOG_RETENTION_DAYS * DAY_MS && stamp_file.is_own_regular_file(target)
}

function prune_log(target: string, now_ms: number): void {
	try {
		if (is_stale(target, now_ms)) rmSync(target, { force: true })
	} catch {
		// Gone already, or not ours to remove.
	}
}

function prune_stale_logs(
	directory: string,
	prefixes: ReadonlyArray<string>,
	now_ms: number,
): void {
	for (const name of list_names(directory)) {
		if (name.endsWith(LOG_SUFFIX) && is_record_name(name, prefixes)) {
			prune_log(path.join(directory, name), now_ms)
		}
	}
}

const durable_state_migrate = { LOG_RETENTION_DAYS, copy_once, is_record_name, prune_stale_logs }

export { durable_state_migrate }
