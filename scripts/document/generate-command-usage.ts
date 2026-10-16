import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { command_usage } from '#scripts/josh/command-usage'

// A reference page keeps its headings and its hand-written behavior prose; only the span between
// `<!-- usage: <command> -->` and `<!-- /usage -->` is generated, from the same usage table
// `josh help <command>` prints. The headings stay put because other documents point at them (#3932).
// Run `tsx scripts/document/generate-command-usage.ts` to regenerate.

const USAGE_PAGES: ReadonlyArray<string> = ['docs/josh-commands.md', 'docs/josh-commands-run.md']
const USAGE_BLOCK = /<!-- usage: (?<name>\S+) -->\n[\s\S]*?<!-- \/usage -->/gu

function usage_block(name: string): string {
	const usage = command_usage.format_usage(name)
	if (usage === undefined) throw new Error(`no usage is registered for \`josh ${name}\``)

	return `<!-- usage: ${name} -->\n\n${usage}\n\n<!-- /usage -->`
}

function fill_usage_blocks(text: string): string {
	return text.replaceAll(USAGE_BLOCK, (_block, name: string) => usage_block(name))
}

function page_path(page: string): string {
	return fileURLToPath(new URL(`../../${page}`, import.meta.url))
}

function regenerate_pages(): void {
	for (const page of USAGE_PAGES) {
		const file = page_path(page)

		writeFileSync(file, fill_usage_blocks(readFileSync(file, 'utf8')))
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) regenerate_pages()

const generate_command_usage = { USAGE_PAGES, fill_usage_blocks, page_path }

export { generate_command_usage }
