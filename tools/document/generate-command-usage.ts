import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { command_usage } from '#scripts/josh/command-usage'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'

// A reference page keeps its headings and its hand-written behavior prose; only the span between
// `<!-- usage: <command> -->` and `<!-- /usage -->` is generated, from the same description and usage
// `josh help <command>` prints. The headings stay put because other documents point at them (#3932).
// Run `tsx tools/document/generate-command-usage.ts` to regenerate.

const { USAGE_PAGES } = command_usage
const USAGE_BLOCK = /<!-- usage: (?<name>\S+) -->\n[\s\S]*?<!-- \/usage -->/gu

// The commands a page renders — the spans the generator fills, not a marker quoted in prose.
function usage_spans(text: string): Array<string> {
	return [...text.matchAll(USAGE_BLOCK)].map((match) => match.groups?.['name'] ?? '')
}

// The registry's one-line description opens the span, so a section's summary is the text
// `josh help` prints rather than a hand-written restatement of it (#4162).
function as_sentence(text: string): string {
	return /[.!?]$/u.test(text) ? text : `${text}.`
}

function summary_line(name: string): string {
	return as_sentence(COMMAND_MAP[name]?.description ?? '')
}

function usage_block(name: string): string {
	const usage = command_usage.format_usage(name)
	if (usage === undefined) throw new Error(`no usage is registered for \`josh ${name}\``)

	return `<!-- usage: ${name} -->\n\n${summary_line(name)}\n\n${usage}\n\n<!-- /usage -->`
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

const generate_command_usage = {
	USAGE_PAGES,
	as_sentence,
	fill_usage_blocks,
	page_path,
	usage_spans,
}

export { generate_command_usage }
