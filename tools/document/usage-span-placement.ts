import type { CommandEntry } from '#scripts/josh/josh-command-map'
import { generate_command_usage } from './generate-command-usage'

// A command added to the map has no `<!-- usage: -->` span yet, and the generator fills only spans
// that exist, so the new command's section is placed here (#4970). The audience picks the page: a
// developer command renders on the developer reference, the rule the coverage test holds. Any other
// command joins the page holding most of the commands it shares a prefix with, after the last of
// them. A command with no such page joins the automation page, at the end of its category's section.

type PlacedEntry = Pick<CommandEntry, 'category' | 'reference'>
type Pages = ReadonlyMap<string, string>

const DEVELOPER_PAGE = 'docs/josh-commands.md'
const FALLBACK_PAGE = 'docs/josh-commands-automation.md'
const SECTION_HEADING = /^#{2,3} /mu
const CATEGORY_HEADING = /^## /mu

function prefix_of(name: string): string {
	return name.split(':', 1)[0] ?? name
}

function siblings(text: string, name: string): Array<string> {
	const prefix = prefix_of(name)

	return generate_command_usage.usage_spans(text).filter((span) => prefix_of(span) === prefix)
}

// Ties keep `USAGE_PAGES` order: `toSorted` is stable.
function sibling_page(name: string, pages: Pages): string | undefined {
	const counted = [...pages]
		.filter(([page]) => page !== DEVELOPER_PAGE)
		.map(([page, text]) => ({ page, count: siblings(text, name).length }))
	const [best] = counted.toSorted((left, right) => right.count - left.count)

	return best !== undefined && best.count > 0 ? best.page : undefined
}

function page_for(name: string, entry: PlacedEntry, pages: Pages): string {
	if (entry.reference[1] === 'developer') return DEVELOPER_PAGE

	return sibling_page(name, pages) ?? FALLBACK_PAGE
}

function heading_index(text: string, from: number, heading: RegExp): number {
	const match = heading.exec(text.slice(from))

	return match === null ? text.length : from + match.index
}

// The next section heading after the last sibling's span, so the sibling keeps its prose and its
// `####` subsections.
function sibling_anchor(text: string, name: string): number | undefined {
	const last = siblings(text, name).at(-1)
	if (last === undefined) return undefined

	return heading_index(text, text.indexOf(`<!-- usage: ${last} -->`), SECTION_HEADING)
}

// Where `line` starts a line of `text`, the first line included; -1 when none does.
function line_index(text: string, line: string): number {
	if (text.startsWith(line)) return 0
	const found = text.indexOf(`\n${line}`)

	return found === -1 ? -1 : found + 1
}

function category_anchor(text: string, category: string): number {
	const heading = `## ${category}\n`
	const start = line_index(text, heading)
	if (start === -1) return text.length

	return heading_index(text, start + heading.length, CATEGORY_HEADING)
}

function span_section(name: string): string {
	return `### \`josh ${name}\`\n\n<!-- usage: ${name} -->\n<!-- /usage -->\n`
}

function insert_section(text: string, at: number, name: string): string {
	const section = at === text.length ? `\n${span_section(name)}` : `${span_section(name)}\n`

	return `${text.slice(0, at)}${section}${text.slice(at)}`
}

function with_span(pages: Pages, name: string, entry: PlacedEntry): Pages {
	const page = page_for(name, entry, pages)
	const text = pages.get(page) ?? ''
	const anchor = sibling_anchor(text, name) ?? category_anchor(text, entry.category)

	return new Map([...pages, [page, insert_section(text, anchor, name)]])
}

// Each page's text with an empty span section for every command no page renders yet; the generator
// fills the spans after.
function place_missing_spans(pages: Pages, commands: Readonly<Record<string, PlacedEntry>>): Pages {
	const present = new Set(
		[...pages.values()].flatMap((text) => generate_command_usage.usage_spans(text)),
	)
	let placed = pages

	for (const [name, entry] of Object.entries(commands)) {
		if (!present.has(name)) placed = with_span(placed, name, entry)
	}

	return placed
}

const usage_span_placement = { place_missing_spans }

export { usage_span_placement }
