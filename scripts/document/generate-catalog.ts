import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
	ALIASES,
	CATEGORY_ORDER,
	COMMAND_MAP,
	type CommandCategory,
	type CommandEntry,
} from '#scripts/josh/josh-command-map'

const CATALOG_FILE = fileURLToPath(new URL('../../docs/josh-command-catalog.md', import.meta.url))

const PREAMBLE = `# josh CLI — Command Catalog

Auto-generated — do not edit.
Run \`tsx scripts/document/generate-catalog.ts\` to regenerate.

`

function aliases_for(command_name: string): ReadonlyArray<string> {
	return Object.entries(ALIASES)
		.filter(([, target]) => target === command_name)
		.map(([alias]) => alias)
		.toSorted((x, y) => x.localeCompare(y))
}

function format_alias_heading(name: string, aliases: ReadonlyArray<string>): string {
	if (aliases.length === 0) return `### \`josh ${name}\``
	const alias_spans = aliases.map((al) => `\`josh ${al}\``).join(' · ')

	return `### \`josh ${name}\` · ${alias_spans}`
}

function format_command_entry(name: string, entry: CommandEntry): string {
	const [synopsis, audience, side_effects] = entry.reference
	const aliases = aliases_for(name)
	const kit_note = entry.is_kit_only === true ? ' · **kit only**' : ''
	const heading = format_alias_heading(name, aliases)
	const meta = `> **Audience:** ${audience} · **Side effects:** ${side_effects.join(', ')}${kit_note}`
	const synopsis_line = synopsis ? `\`${synopsis}\`` : '_No arguments._'

	return [heading, '', meta, '', synopsis_line, '', entry.description].join('\n')
}

function entries_for_category(category: CommandCategory): Array<[string, CommandEntry]> {
	return Object.entries(COMMAND_MAP)
		.filter(([, entry]) => entry.category === category)
		.toSorted(([name_a], [name_b]) => name_a.localeCompare(name_b))
}

function generate_category_section(category: CommandCategory): string {
	const entries = entries_for_category(category)
	if (entries.length === 0) return ''
	const command_blocks = entries.map(([name, entry]) => format_command_entry(name, entry))

	return `## ${category}\n\n${command_blocks.join('\n\n---\n\n')}\n\n`
}

function generate_catalog(): string {
	const content = PREAMBLE + CATEGORY_ORDER.map((cat) => generate_category_section(cat)).join('')

	return `${content.trimEnd()}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	writeFileSync(CATALOG_FILE, generate_catalog())
}

export { CATALOG_FILE, generate_catalog }
