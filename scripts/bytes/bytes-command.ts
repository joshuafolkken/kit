#!/usr/bin/env tsx
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { document_byte_budget } from '#scripts/document/document-byte-budget'
import { entry_read_budget } from '#scripts/document/entry-read-budget'

// The repository-root-relative path resolved to an absolute one, keyed off this file's own location
// rather than the process cwd — so a path typed the way the budget records it resolves the same from
// any directory. This script is two levels below the root (`scripts/bytes/`), the same offset
// `generate-catalog.ts` resolves its output by; it carries no test fixture into the shipped command.
function package_file(relative_path: string): string {
	return fileURLToPath(new URL(`../../${relative_path}`, import.meta.url))
}

// The repository root, the base `entry-read-budget.ts` measures each entry's total read against — the
// same two-levels-up offset `package_file` resolves a document by.
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

// `josh bytes` — the byte counterpart of `josh lines` (joshuafolkken/kit#2176). A mandated
// documentation update that grows an agent-read document past its byte ceiling is invisible until
// `pnpm josh gate` reports it 80–90 seconds in, and the raise that follows is rework. This answers
// the same question before that: how many bytes each budgeted document already has, its ceiling, and
// how many are left — the number to check right after an edit.
//
// **It reports and never fails**, exactly as `josh lines` does. The ceiling is the gate's to enforce
// (and `josh lint:related` now enforces it early, sharing `document-byte-budget.ts`); a second
// command exiting non-zero on the same condition would be a second enforcement point, which is how a
// headroom report turns into a way to reinterpret the gate. A non-zero exit here means the arguments
// were unusable, never that a document is large.

const ARGV_START = 2
const ROW_GAP = '  '
// The no-argument scan's answer when nothing sits near its ceiling — a defined "none" rather than an
// empty output that would read as a broken command.
const NONE_NEAR = 'no document near its byte ceiling'
// A path argument that names no agent-read document has no ceiling to be counted against — the budget
// covers exactly those documents, and quoting a limit for anything else would answer a question
// nobody asked.
const NOT_BUDGETED = 'not counted: no byte budget for this path'
// A path argument the tree does not hold: a typo, or a document that was removed.
const NOT_A_FILE = 'not counted: no file at this path'

interface DocumentStatus {
	path: string
	current: number
	recorded: number
	remaining: number
}

function status_of(relative_path: string, recorded: number): DocumentStatus {
	const current = statSync(package_file(relative_path)).size
	const remaining = document_byte_budget.remaining_bytes(recorded, current)

	return { path: relative_path, current, recorded, remaining }
}

// An over-budget row names the number to record — the next block multiple, the same value
// `over_budget_message` states; an in-budget row names the headroom left, so a reader sees the margin
// before spending it.
function status_body(status: DocumentStatus): string {
	const ceiling = status.recorded.toString()
	const current = status.current.toString()
	const next = document_byte_budget.block_ceiling(status.current).toString()

	if (status.remaining < 0) {
		return `${current}/${ceiling} bytes · over by ${(-status.remaining).toString()} — raise recorded to ${next}`
	}

	return `${current}/${ceiling} bytes · ${status.remaining.toString()} left`
}

function status_row(status: DocumentStatus): string {
	return `${status.path}${ROW_GAP}${status_body(status)}`
}

// A leading `./` is stripped so a path typed the way it reads on screen matches the repository-root
// spelling the budget records; anything else is compared as given.
function normalized_path(argument: string): string {
	return argument.startsWith('./') ? argument.slice('./'.length) : argument
}

function argument_row(argument: string): string {
	const relative_path = normalized_path(argument)
	const recorded = document_byte_budget.recorded_bytes_for(relative_path)

	if (recorded === undefined) return `${relative_path}${ROW_GAP}${NOT_BUDGETED}`
	if (!existsSync(package_file(relative_path))) return `${relative_path}${ROW_GAP}${NOT_A_FILE}`

	return status_row(status_of(relative_path, recorded))
}

// A document is "near its ceiling" once less than this is left before its recorded block ceiling —
// the point where the next addition tips it over and forces a deterministic bump. Display-only, so it
// is this command's own dial rather than the ratchet's block size.
const NEAR_CEILING_BYTES = 512

// The scan reports the documents nearing their ceiling — less than `NEAR_CEILING_BYTES` of headroom
// left before the next block bump — least headroom first, so an over-budget document sorts ahead of
// one that merely has little room left. A document freshly recorded to its block sits with the whole
// block of headroom and is left out, so the scan surfaces what is moving toward its ceiling rather
// than the whole budget.
function near_ceiling_statuses(): ReadonlyArray<DocumentStatus> {
	return document_byte_budget.DOCUMENT_BYTE_BUDGET.map((entry) =>
		status_of(entry.path, entry.bytes),
	)
		.filter((status) => status.remaining < NEAR_CEILING_BYTES)
		.toSorted((left, right) => left.remaining - right.remaining)
}

interface EntryStatus {
	entry: string
	current: number
	recorded: number
	remaining: number
}

function entry_status_of(entry: string, recorded: number): EntryStatus {
	const current = entry_read_budget.entry_total_bytes(REPO_ROOT, entry)
	const remaining = document_byte_budget.remaining_bytes(recorded, current)

	return { entry, current, recorded, remaining }
}

function remaining_phrase(remaining: number): string {
	return remaining < 0 ? `over by ${(-remaining).toString()}` : `${remaining.toString()} left`
}

// The primary budget, one row per entry: the total each workflow entry reads against its recorded
// ceiling and the headroom left — printed on every scan, so the main budget is no longer a number the
// gate reveals only when it fails (joshuafolkken/kit#2271).
function entry_row(status: EntryStatus): string {
	const counts = `${status.current.toString()}/${status.recorded.toString()} bytes`

	return `entry ${status.entry}${ROW_GAP}${counts} · ${remaining_phrase(status.remaining)}`
}

function entry_rows(): ReadonlyArray<string> {
	return entry_read_budget.ENTRY_READ_BUDGET.map((one) =>
		entry_row(entry_status_of(one.entry, one.bytes)),
	)
}

function scan_lines(): ReadonlyArray<string> {
	const near = near_ceiling_statuses().map((status) => status_row(status))

	return [near.length === 0 ? NONE_NEAR : near.join('\n'), ...entry_rows()]
}

function run_scan(): number {
	process.stdout.write(`${scan_lines().join('\n')}\n`)

	return 0
}

function run_arguments(command_arguments: ReadonlyArray<string>): number {
	const rows = command_arguments.map((argument) => argument_row(argument))

	process.stdout.write(`${rows.join('\n')}\n`)

	return 0
}

function run_bytes(command_arguments: ReadonlyArray<string>): number {
	return command_arguments.length === 0 ? run_scan() : run_arguments(command_arguments)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = run_bytes(process.argv.slice(ARGV_START))
}

const bytes_command = {
	argument_row,
	entry_row,
	entry_rows,
	near_ceiling_statuses,
	run_bytes,
	scan_lines,
	status_row,
	NONE_NEAR,
	NOT_A_FILE,
	NOT_BUDGETED,
}

export { bytes_command }
