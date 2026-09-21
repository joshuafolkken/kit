import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { document_byte_budget } from './document-byte-budget'
import { document_reachability } from './document-reachability'
import { entry_read_budget } from './entry-read-budget'

// The byte-ceiling check the gate's `document-byte-budget.test.ts` runs, made reachable on the fast
// between-edits path — `josh lint:related` calls it over the files it already resolved so a mandated
// documentation update that grows a document past its ceiling is caught in seconds rather than after
// the 80–90-second gate (joshuafolkken/kit#2176). The ceiling and its message are
// `document-byte-budget.ts`'s alone: this adds no budget of its own, so the fast path can never hold
// a different line from the gate, and widening one can never loosen the other.
//
// **It reads no change of its own.** `lint:related` has already resolved which files the change
// touched; taking that same list keeps the check inside the lint command's git contract — no second
// reading, and none at all when the caller narrowed by explicit arguments.

const LABEL = 'byte budget'

// The over-ceiling message given a size that is already known — the recorded value and the current
// size are handed in, so the decision is pure and tested without a filesystem or a budget lookup. A
// path with no budget entry (`recorded` undefined) is out of scope: the budget names exactly the
// agent-read documents, and everything else is not this check's to hold.
function ceiling_message(
	relative_path: string,
	current_bytes: number,
	recorded_bytes: number | undefined,
): string | undefined {
	if (recorded_bytes === undefined) return undefined
	if (current_bytes <= recorded_bytes) return undefined

	return document_byte_budget.over_budget_message(relative_path, current_bytes, recorded_bytes)
}

// The same decision for an absolute path the caller resolved: its budget looked up by the
// repository-relative spelling, its size read from disk. A path with no budget entry, or one the
// tree no longer holds, is not over budget.
function over_budget_for(root: string, absolute_path: string): string | undefined {
	const relative_path = path.relative(root, absolute_path)
	const recorded = document_byte_budget.recorded_bytes_for(relative_path)
	if (recorded === undefined || !existsSync(absolute_path)) return undefined

	return ceiling_message(relative_path, statSync(absolute_path).size, recorded)
}

// Every over-ceiling message across the resolved file list, in the order the files came in.
function over_budget_messages(
	root: string,
	absolute_files: ReadonlyArray<string>,
): ReadonlyArray<string> {
	return absolute_files
		.map((absolute_path) => over_budget_for(root, absolute_path))
		.filter((message): message is string => message !== undefined)
}

// The entry-total counterpart: an entry over its recorded ceiling. This is the primary budget
// (joshuafolkken/kit#2257), so an edit to a covered document — which grows an entry's total, not a
// per-document ceiling — is caught here on the same fast path. Stale ceilings are left to the gate's
// `entry-read-budget.test.ts`, exactly as the per-document staleness is: this path blocks growth.
function entry_over_budget_message(root: string, entry: string): string | undefined {
	const recorded = entry_read_budget.recorded_bytes_for(entry)
	if (recorded === undefined) return undefined

	const current = entry_read_budget.entry_total_bytes(root, entry)
	if (current <= recorded) return undefined

	return entry_read_budget.over_budget_message(entry, current, recorded)
}

function entry_over_budget_messages(root: string): ReadonlyArray<string> {
	return entry_read_budget.ENTRY_READ_BUDGET.map((entry) =>
		entry_over_budget_message(root, entry.entry),
	).filter((message): message is string => message !== undefined)
}

// Whether the change touches a document some entry reads. A covered document's edit moves an entry
// total rather than a per-document ceiling, so the entry check runs only when one is in scope.
function touches_covered(root: string, absolute_files: ReadonlyArray<string>): boolean {
	const covered = new Set(document_reachability.covered_documents(root))

	return absolute_files.some((absolute_path) => covered.has(path.relative(root, absolute_path)))
}

// Prints one labelled line per over-ceiling message and answers non-zero, or stays silent and
// answers zero when nothing is over budget.
function report(messages: ReadonlyArray<string>): number {
	if (messages.length === 0) return 0

	const lines = messages.map((message) => `${LABEL}: ${message}`)

	process.stdout.write(`${lines.join('\n')}\n`)

	return 1
}

// The check over a resolved change — every over-ceiling document among the files the caller narrowed
// by, plus the entry totals when the change touches a document some entry reads.
function check_files(root: string, absolute_files: ReadonlyArray<string>): number {
	const entry_messages = touches_covered(root, absolute_files)
		? entry_over_budget_messages(root)
		: []

	return report([...over_budget_messages(root, absolute_files), ...entry_messages])
}

// The check the caller runs when its scope widened to the whole tree (`mode === 'all'`) instead of a
// resolved change. `lint:related`'s own fallback lints a superset of the change, so the byte check
// widens to the whole budget rather than an empty file list — otherwise the fallback would report
// success on a tree it never read for bytes, and the green record the caller then writes would vouch
// for a byte dimension it never checked (joshuafolkken/kit#2176).
function check_all(root: string): number {
	const absolute_files = document_byte_budget.DOCUMENT_BYTE_BUDGET.map((entry) =>
		path.join(root, entry.path),
	)

	return report([
		...over_budget_messages(root, absolute_files),
		...entry_over_budget_messages(root),
	])
}

const document_byte_check = {
	ceiling_message,
	check_all,
	check_files,
	entry_over_budget_messages,
	over_budget_for,
	over_budget_messages,
}

export { document_byte_check }
