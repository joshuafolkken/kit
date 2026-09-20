#!/usr/bin/env tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bash_output_cap_reader } from './bash-output-cap'
import { document_section } from './document-section'

// `josh read:files <path> [<path> ...]` — read several files in one call
// (joshuafolkken/kit#2202).
//
// **This is the mid-implementation counterpart of `run:prep`.** `run:prep` folds a run's pre-edit
// reads into one call at a *pre-determined* point (before implementing), and kit#2165 / kit#2162
// showed that folding a routine section into one composite command is the only lever that has moved
// round-trip density — advice did not (kit#1304), a live density line did not (kit#1329 / kit#1337),
// and the lane-child notice did not (kit#2164, taken off in kit#2178). What those composite commands
// could not reach is the implementation phase itself: an agent editing several files reads one, edits
// it, reads the next, edits it — the interleaved nine-turn sequence kit#2178 measured — because the
// edit set is not a routine known in advance.
//
// **But it is known one moment earlier: Step 0 enumerates every change with its file.** So there is a
// pre-determined point after all, and this is the command that folds the reads at it: given the Step 0
// target list, it returns every file's contents in one call. The reads collapse to one turn, and — the
// whole point — the edits that follow no longer depend on an interleaved read, so they fall out into
// one turn too. The lever is structural, not another way to *say* "batch": `report-format.md` routes
// the run here at the Step 0 seam, beside the `josh lines` step that already reads the same list.
//
// **Under the cap it prints every file; over it, a directive and no content**, the invariant
// `doc:read` holds for one file (kit#2188). A truncated preview is the failure this refuses — so an
// over-cap batch is not printed but named, and the directive tells the run to read the files with the
// Read tool *in one turn*, which keeps the reads folded even on the fallback path.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const NONE = 0
const USAGE = 'Usage: josh read:files <path> [<path> ...]'
const OVER_CAP_PREFIX = 'Over the Bash cap'
const READ_TOOL_DIRECTIVE = 'read these files with the Read tool in one turn, not cat:'
// The rule that fences each file's contents, so a reader — and a `grep` — finds where one file ends
// and the next begins in the single blob this prints.
const HEADER_RULE = '====='
const BLOCK_SEPARATOR = '\n\n'

interface FileRead {
	path: string
	text: string | undefined
}

interface PresentRead {
	path: string
	text: string
}

function byte_length(text: string): number {
	return Buffer.byteLength(text, 'utf8')
}

function read_one(name: string, root: string): FileRead {
	return { path: name, text: document_section.read_optional(path.resolve(root, name)) }
}

function is_present(read: FileRead): read is PresentRead {
	return read.text !== undefined
}

function file_block(read: PresentRead): string {
	return `${HEADER_RULE} ${read.path} ${HEADER_RULE}\n${read.text}`
}

function combined_text(present: ReadonlyArray<PresentRead>): string {
	return present.map((read) => file_block(read)).join(BLOCK_SEPARATOR)
}

// The one line that stands in for an over-cap batch: both figures so the reason is legible, every
// path so the Read tool has its arguments, and none of the files' content.
function over_cap_directive(paths: ReadonlyArray<string>, bytes: number, cap: number): string {
	const figures = `(${bytes.toLocaleString('en-US')} B > ${cap.toLocaleString('en-US')} B)`

	return `${OVER_CAP_PREFIX} ${figures} — ${READ_TOOL_DIRECTIVE} ${paths.join(' ')}`
}

// Print every present file in one call, or — over the cap — the directive and no content, never a
// truncated preview. Nothing at all when no named file could be read; the missing ones are reported
// separately.
function print_present(present: ReadonlyArray<PresentRead>, cap: number): void {
	if (present.length === NONE) return

	const text = combined_text(present)
	const bytes = byte_length(text)
	const paths = present.map((read) => read.path)

	if (bytes > cap) console.info(over_cap_directive(paths, bytes, cap))
	else console.info(text)
}

// Every path that resolved to nothing is named, and one such path makes the whole call non-zero — a
// caller that asked for a file it did not get is told which one rather than left to subtract.
function report_missing(reads: ReadonlyArray<FileRead>): number {
	const missing = reads.filter((read) => !is_present(read))

	for (const read of missing) console.error(`Cannot read ${read.path}`)

	return missing.length > NONE ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

function run(argv: ReadonlyArray<string>, root: string = process.cwd()): number {
	if (argv.length === NONE) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reads = argv.map((name) => read_one(name, root))

	print_present(reads.filter(is_present), bash_output_cap_reader.bash_output_cap(root))

	return report_missing(reads)
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const read_files_cli = {
	OVER_CAP_PREFIX,
	READ_TOOL_DIRECTIVE,
	SUCCESS_EXIT_CODE,
	USAGE,
	main,
	over_cap_directive,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { read_files_cli }
