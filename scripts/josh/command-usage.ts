import { canonical_command } from './josh-aliases'
import { COMMAND_MAP } from './josh-command-map'
import type { CommandUsage } from './josh-command-types'

// The single renderer of a command's usage. `josh help <command>` prints it and
// `josh command:derive` writes it between a reference page's usage markers,
// so the terminal and the page are one text (#3932). The usage itself sits on each command's entry
// (#4185); which page renders it is the page's own `<!-- usage: <command> -->` span.

const USAGE_PAGES: ReadonlyArray<string> = [
	'docs/josh-commands.md',
	'docs/josh-commands-run.md',
	'docs/josh-commands-backlog.md',
	'docs/josh-commands-automation.md',
]
const NOTE_GAP = 3

interface ExampleLine {
	command: string
	note: string | undefined
}

function usage_for(name: string): CommandUsage | undefined {
	return Object.hasOwn(COMMAND_MAP, name) ? COMMAND_MAP[name]?.usage : undefined
}

function example_line(name: string, example: CommandUsage['examples'][number]): ExampleLine {
	const command = example.arguments ? `pnpm josh ${name} ${example.arguments}` : `pnpm josh ${name}`

	return { command, note: example.note }
}

// Every comment starts in one column, so a block reads as a table of what each spelling does.
function format_examples(name: string, usage: CommandUsage): string {
	const lines = usage.examples.map((example) => example_line(name, example))
	const width = Math.max(...lines.map((line) => line.command.length)) + NOTE_GAP
	const rendered = lines.map((line) =>
		line.note === undefined ? line.command : `${line.command.padEnd(width)}# ${line.note}`,
	)

	return ['```bash', ...rendered, '```'].join('\n')
}

function code_span(text: string): string {
	return `\`${text}\``
}

function format_flags(flags: NonNullable<CommandUsage['flags']>): string {
	const items = flags.map(
		(flag) =>
			`- ${flag.names.map((spelling) => code_span(spelling)).join(' / ')} — ${flag.description}`,
	)

	return ['**Options:**', '', ...items].join('\n')
}

function format_usage(name: string): string | undefined {
	const usage = usage_for(name)
	if (usage === undefined) return undefined
	const flags = usage.flags === undefined ? [] : [format_flags(usage.flags)]

	return [format_examples(name, usage), ...flags].join('\n\n')
}

// `josh help <command>`: the synopsis line, the description, then the usage block. An alias
// resolves to its command; a name that is neither answers `undefined`.
function format_command_help(input: string): string | undefined {
	const name = canonical_command(input)
	const entry = Object.hasOwn(COMMAND_MAP, name) ? COMMAND_MAP[name] : undefined
	if (entry === undefined) return undefined
	const [synopsis] = entry.reference
	const head = synopsis ? `josh ${name} ${synopsis}` : `josh ${name}`

	return [head, '', entry.description, '', format_usage(name)].join('\n')
}

const command_usage = {
	USAGE_PAGES,
	format_command_help,
	format_usage,
}

export { command_usage }
