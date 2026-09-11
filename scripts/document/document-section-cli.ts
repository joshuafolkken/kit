#!/usr/bin/env tsx
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { document_section } from './document-section'
import { entry_read_set } from './entry-read-set'

// `josh doc:section` — print one section of a markdown document (joshuafolkken/kit#1776).
//
// **It exists because the documents already cite each other by section and the reader could only
// fetch files.** `` `epicrun.md` → "The hand-off" `` names 249 lines; opening `epicrun.md` costs
// 2,121. Every entry point pays that difference at the moment it starts, before anything has been
// implemented.
//
// **What it is not is a summary.** The section is printed verbatim, headings and all, so a run that
// reads a section has read the same words a run that opened the file would have. Nothing is deferred
// and nothing is condensed — the extent of the read changes, not its content, which is why this is
// not the "read it later" scheme joshuafolkken/kit#1344 and joshuafolkken/kit#1460 each measured
// never firing.
//
// **A heading that does not resolve is a refusal, not an empty answer.** A pointer whose target was
// renamed would otherwise print nothing and read as a section with nothing in it — the one outcome
// that is worse than reading the whole file.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const FILE_ARGUMENT = 0
const HEADING_ARGUMENT = 1
const NO_CANDIDATE = 0
const USAGE = 'Usage: josh doc:section <file.md> "<heading>"'

// A bare `epicrun.md` means the workflow skill's own copy, because that is how every reference in
// those documents spells it; anything that resolves as a path is taken as one.
function resolve_document(name: string, root: string = process.cwd()): string {
	if (existsSync(name)) return name

	const in_skill = entry_read_set.document_path(root, name)

	return existsSync(in_skill) ? in_skill : path.resolve(root, name)
}

function report_missing(markdown: string, heading: string): number {
	const near = document_section.candidates(markdown, heading)
	const listed = near.length > NO_CANDIDATE ? near : document_section.titles(markdown)

	console.error(`No single section matches ${JSON.stringify(heading)}. Headings it could mean:`)
	for (const title of listed) console.error(`  ${title}`)

	return FAILURE_EXIT_CODE
}

function print_section(markdown: string, heading: string): number {
	const found = document_section.section(markdown, heading)

	if (found === undefined) return report_missing(markdown, heading)

	console.info(found.text)

	return 0
}

function read_named(name: string, root: string): string | undefined {
	const file_path = resolve_document(name, root)
	const markdown = document_section.read_optional(file_path)

	if (markdown === undefined) console.error(`Cannot read ${file_path}`)

	return markdown
}

function run(argv: ReadonlyArray<string>, root: string = process.cwd()): number {
	const name = argv[FILE_ARGUMENT]
	const heading = argv[HEADING_ARGUMENT]

	if (name === undefined || heading === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const markdown = read_named(name, root)

	return markdown === undefined ? FAILURE_EXIT_CODE : print_section(markdown, heading)
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const document_section_cli = { FAILURE_EXIT_CODE, USAGE, main, resolve_document, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { document_section_cli }
