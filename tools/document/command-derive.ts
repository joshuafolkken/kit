#!/usr/bin/env tsx
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { derived_artifacts } from './derived-artifacts'
import { generate_catalog } from './generate-catalog'
import { generate_command_usage } from './generate-command-usage'
import { generate_lint_prose } from './generate-lint-prose'
import { usage_span_placement } from './usage-span-placement'

// `josh command:derive` — write every artifact derived from the command map, and the lint prose spans
// derived from the lint config, in one run, then print each command page's bytes beside its ceiling.
// `--check` writes nothing: it names each page the run would rewrite (joshuafolkken/kit#7728).

const { page_path, USAGE_PAGES } = generate_command_usage
const { CHECK_FLAG, DERIVE_COMMAND } = derived_artifacts
const CATALOG_PAGE = 'docs/josh-command-catalog.md'
const ARGV_OFFSET = 2

function read_page(page: string): string {
	return readFileSync(page_path(page), 'utf8')
}

function read_usage_pages(): ReadonlyMap<string, string> {
	return new Map(USAGE_PAGES.map((page) => [page, read_page(page)]))
}

function filled_usage_pages(pages: ReadonlyMap<string, string>): Array<[string, string]> {
	const placed = usage_span_placement.place_missing_spans(pages, COMMAND_MAP)

	return [...placed].map(([page, text]) => [page, generate_command_usage.fill_usage_blocks(text)])
}

// Filled before anything is written: a span the lint config cannot render throws here, not midway.
function filled_lint_prose_pages(): Array<[string, string]> {
	return generate_lint_prose.LINT_PROSE_PAGES.map((page) => [
		page,
		generate_lint_prose.fill_lint_spans(read_page(page)),
	])
}

// Every page the run writes, keyed by its repository path, with the text it writes there; a lint
// prose page read before any write keeps the last word, as it did when each was written in turn.
function derived_pages(pages: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
	return new Map([
		...filled_usage_pages(pages),
		[CATALOG_PAGE, generate_catalog()],
		...filled_lint_prose_pages(),
	])
}

function write_pages(pages: ReadonlyMap<string, string>): void {
	for (const [page, text] of pages) writeFileSync(page_path(page), text)
}

function drifted_pages(pages: ReadonlyMap<string, string>): Array<string> {
	return [...pages].filter(([page, text]) => read_page(page) !== text).map(([page]) => page)
}

function report_drift(pages: ReadonlyMap<string, string>): number {
	const drifted = drifted_pages(pages)

	if (drifted.length === 0) return 0
	console.error(
		`command:derive ${CHECK_FLAG}: \`${DERIVE_COMMAND}\` would rewrite these generated pages — move each hand edit into its source (the command map or the lint config), then run it:\n${drifted.join('\n')}`,
	)

	return 1
}

// Non-zero when a written page is over its ceiling, so the run names the page to shrink.
function report_bytes(): number {
	const sizes = [...USAGE_PAGES, CATALOG_PAGE].map((path) => ({
		path,
		bytes: statSync(page_path(path)).size,
	}))

	console.info(sizes.map((size) => derived_artifacts.byte_line(size)).join('\n'))

	return sizes.some((size) => derived_artifacts.is_over(size)) ? 1 : 0
}

// A span naming no command stops the run before anything is written: filling it would throw midway.
function has_stale_spans(pages: ReadonlyMap<string, string>): boolean {
	const stale = usage_span_placement.stale_spans(pages, COMMAND_MAP)

	if (stale.length === 0) return false
	console.error(
		`command:derive: rename or delete the section of each span naming no command:\n${stale.join('\n')}`,
	)

	return true
}

function main(argv: ReadonlyArray<string> = process.argv.slice(ARGV_OFFSET)): number {
	const pages = read_usage_pages()

	if (has_stale_spans(pages)) return 1
	const derived = derived_pages(pages)

	if (argv.includes(CHECK_FLAG)) return report_drift(derived)
	write_pages(derived)

	return report_bytes()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main()

const command_derive = { main }

export { command_derive }
