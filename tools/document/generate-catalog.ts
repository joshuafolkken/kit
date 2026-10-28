import { fileURLToPath } from 'node:url'
import { ALIASES } from '#scripts/josh/josh-aliases'
import {
	CATEGORY_ORDER,
	COMMAND_MAP,
	type CommandCategory,
	type CommandEntry,
} from '#scripts/josh/josh-command-map'
import { derived_artifacts } from './derived-artifacts'

const CATALOG_FILE = fileURLToPath(new URL('../../docs/josh-command-catalog.md', import.meta.url))

// The heading and a stale-catalog test failure both name it, so the failure says how to fix it (#4784)
// — the one command that writes every artifact the command map derives (#4970).
const REGENERATE_COMMAND = derived_artifacts.DERIVE_COMMAND

const PREAMBLE = `# josh CLI — Command Catalog

Auto-generated — do not edit.
Run \`${REGENERATE_COMMAND}\` to regenerate.

`

function aliases_for(command_name: string): ReadonlyArray<string> {
	return Object.entries(ALIASES)
		.filter(([, target]) => target === command_name)
		.map(([alias]) => alias)
		.toSorted((x, y) => x.localeCompare(y))
}

// One row per command (#4162): a `|` inside a cell, code span included, would end the cell.
const TABLE_HEAD = [
	'| Command | Arguments | Audience | Side effects | Description |',
	'| --- | --- | --- | --- | --- |',
].join('\n')

function table_cell(text: string): string {
	return text.replaceAll('|', String.raw`\|`)
}

function format_command_cell(name: string, entry: CommandEntry): string {
	const spans = [name, ...aliases_for(name)].map((spelling) => `\`josh ${spelling}\``).join(' · ')

	return entry.is_kit_only === true ? `${spans} · **kit only**` : spans
}

function format_command_entry(name: string, entry: CommandEntry): string {
	const [synopsis, audience, side_effects] = entry.reference
	const cells = [
		format_command_cell(name, entry),
		synopsis ? `\`${synopsis}\`` : '—',
		audience,
		side_effects.join(', '),
		entry.description,
	]

	return `| ${cells.map((cell) => table_cell(cell)).join(' | ')} |`
}

function entries_for_category(category: CommandCategory): Array<[string, CommandEntry]> {
	return Object.entries(COMMAND_MAP)
		.filter(([, entry]) => entry.category === category)
		.toSorted(([name_a], [name_b]) => name_a.localeCompare(name_b))
}

function generate_category_section(category: CommandCategory): string {
	const entries = entries_for_category(category)
	if (entries.length === 0) return ''
	const rows = entries.map(([name, entry]) => format_command_entry(name, entry))

	return `## ${category}\n\n${TABLE_HEAD}\n${rows.join('\n')}\n\n`
}

function generate_catalog(): string {
	const content = PREAMBLE + CATEGORY_ORDER.map((cat) => generate_category_section(cat)).join('')

	return `${content.trimEnd()}\n`
}

export { CATALOG_FILE, format_command_entry, generate_catalog, REGENERATE_COMMAND }
