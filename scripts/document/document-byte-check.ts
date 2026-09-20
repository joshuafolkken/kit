import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { document_byte_budget } from './document-byte-budget'

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
	if (current_bytes <= document_byte_budget.ceiling_for(recorded_bytes)) return undefined

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

// Prints one labelled line per over-ceiling message and answers non-zero, or stays silent and
// answers zero when nothing is over budget.
function report(messages: ReadonlyArray<string>): number {
	if (messages.length === 0) return 0

	const lines = messages.map((message) => `${LABEL}: ${message}`)

	process.stdout.write(`${lines.join('\n')}\n`)

	return 1
}

// The check over a resolved change — every over-ceiling document among the files the caller narrowed
// by.
function check_files(root: string, absolute_files: ReadonlyArray<string>): number {
	return report(over_budget_messages(root, absolute_files))
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

	return report(over_budget_messages(root, absolute_files))
}

const document_byte_check = {
	ceiling_message,
	check_all,
	check_files,
	over_budget_for,
	over_budget_messages,
}

export { document_byte_check }
