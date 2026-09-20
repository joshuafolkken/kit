#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { bash_output_cap_reader } from './bash-output-cap'
import { document_section } from './document-section'
import { document_section_cli } from './document-section-cli'

// `josh doc:read <file>` — a Bash-cap-safe read path for a whole document (joshuafolkken/kit#2188).
//
// **A `cat` of a document larger than the Bash output cap is a truncated preview, then a second read.**
// `read:set` measured one entry paying for the same five files twice this way (joshuafolkken/kit#1797):
// the shell hands back a middle-truncated preview, so the file is read again with the `Read` tool. This
// command is the path that avoids it — it never emits an over-cap document through the shell at all.
//
// **Under the cap it prints the document; over it, it prints a directive and no content.** A document
// that fits is delivered here in one call. One that does not is *not* printed — a truncated preview is
// the failure this exists to refuse — so what comes back is one line naming the file and the `Read`
// tool, which reads it once. `doc:section` remains the way to fetch a single heading; this is for the
// whole file when a heading will not do.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const FILE_ARGUMENT = 0
const USAGE = 'Usage: josh doc:read <file.md>'
const OVER_CAP_PREFIX = 'Over the Bash cap'
const READ_TOOL_DIRECTIVE = 'read it with the Read tool, not cat:'

function byte_length(text: string): number {
	return Buffer.byteLength(text, 'utf8')
}

// The one line that stands in for an over-cap document. It names both figures so the reason is legible
// and the path so the `Read` tool has its argument, and it carries no content of the file.
function over_cap_directive(file_path: string, bytes: number, cap: number): string {
	const figures = `(${bytes.toLocaleString('en-US')} B > ${cap.toLocaleString('en-US')} B)`

	return `${OVER_CAP_PREFIX} ${figures} — ${READ_TOOL_DIRECTIVE} ${file_path}`
}

function print_document(file_path: string, text: string, cap: number): number {
	if (byte_length(text) > cap) console.info(over_cap_directive(file_path, byte_length(text), cap))
	else console.info(text)

	return 0
}

function run(argv: ReadonlyArray<string>, root: string = process.cwd()): number {
	const name = argv[FILE_ARGUMENT]

	if (name === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const file_path = document_section_cli.resolve_document(name, root)
	const text = document_section.read_optional(file_path)

	if (text === undefined) {
		console.error(`Cannot read ${file_path}`)

		return FAILURE_EXIT_CODE
	}

	return print_document(file_path, text, bash_output_cap_reader.bash_output_cap(root))
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const document_read_cli = {
	OVER_CAP_PREFIX,
	READ_TOOL_DIRECTIVE,
	USAGE,
	main,
	over_cap_directive,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { document_read_cli }
