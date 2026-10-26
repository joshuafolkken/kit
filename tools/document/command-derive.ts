import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { execa } from 'execa'
import { derived_artifacts } from './derived-artifacts'
import { CATALOG_FILE, generate_catalog } from './generate-catalog'
import { generate_command_usage } from './generate-command-usage'
import { usage_span_placement } from './usage-span-placement'

// `josh command:derive` — write every artifact derived from the command map in one run, then print
// each written page's bytes beside its ceiling (#4970). The snapshot goes through vitest, its only
// writer. The test file comes before `--update`: vitest's `--update` takes an optional value, so a
// path after it is read as the update mode and the whole suite runs.

const { page_path, USAGE_PAGES } = generate_command_usage
const CATALOG_PAGE = 'docs/josh-command-catalog.md'
const WHY_PAGE = 'docs/why.md'
const SNAPSHOT_TEST = 'scripts/josh/josh-command-map.test.ts'

function write_usage_pages(): void {
	const pages = new Map(USAGE_PAGES.map((page) => [page, readFileSync(page_path(page), 'utf8')]))
	const placed = usage_span_placement.place_missing_spans(pages, COMMAND_MAP)

	for (const [page, text] of placed) {
		writeFileSync(page_path(page), generate_command_usage.fill_usage_blocks(text))
	}
}

function write_why_counts(): void {
	const file = page_path(WHY_PAGE)

	writeFileSync(file, derived_artifacts.rewrite_why_counts(readFileSync(file, 'utf8')))
}

async function update_snapshot(): Promise<void> {
	await execa('pnpm', ['exec', 'vitest', 'run', SNAPSHOT_TEST, '--update'], {
		cwd: page_path('.'),
		stdio: 'inherit',
	})
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

async function main(): Promise<number> {
	write_usage_pages()
	writeFileSync(CATALOG_FILE, generate_catalog())
	write_why_counts()
	await update_snapshot()

	return report_bytes()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main()
