#!/usr/bin/env tsx
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { derived_artifacts } from './derived-artifacts'
import { CATALOG_FILE, generate_catalog } from './generate-catalog'
import { generate_command_usage } from './generate-command-usage'
import { usage_span_placement } from './usage-span-placement'

// `josh command:derive` — write every artifact derived from the command map in one run, then print
// each written page's bytes beside its ceiling.

const { page_path, USAGE_PAGES } = generate_command_usage
const CATALOG_PAGE = 'docs/josh-command-catalog.md'
const WHY_PAGE = 'docs/why.md'

function read_usage_pages(): ReadonlyMap<string, string> {
	return new Map(USAGE_PAGES.map((page) => [page, readFileSync(page_path(page), 'utf8')]))
}

function write_usage_pages(pages: ReadonlyMap<string, string>): void {
	const placed = usage_span_placement.place_missing_spans(pages, COMMAND_MAP)

	for (const [page, text] of placed) {
		writeFileSync(page_path(page), generate_command_usage.fill_usage_blocks(text))
	}
}

function write_why_counts(): void {
	const file = page_path(WHY_PAGE)

	writeFileSync(file, derived_artifacts.rewrite_why_counts(readFileSync(file, 'utf8')))
}

// Non-zero when a written page is over its ceiling, so the run names the page to shrink.
function report_bytes(): number {
	const sizes = [...USAGE_PAGES, CATALOG_PAGE, WHY_PAGE].map((path) => ({
		path,
		bytes: statSync(page_path(path)).size,
	}))

	console.info(sizes.map((size) => derived_artifacts.byte_line(size)).join('\n'))

	return sizes.some((size) => derived_artifacts.is_over(size)) ? 1 : 0
}

// A span naming no command stops the run before anything is written: filling it would throw midway.
function main(): number {
	const pages = read_usage_pages()
	const stale = usage_span_placement.stale_spans(pages, COMMAND_MAP)

	if (stale.length > 0) {
		console.error(
			`command:derive: rename or delete the section of each span naming no command:\n${stale.join('\n')}`,
		)

		return 1
	}

	write_usage_pages(pages)
	writeFileSync(CATALOG_FILE, generate_catalog())
	write_why_counts()

	return report_bytes()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main()

const command_derive = { main }

export { command_derive }
