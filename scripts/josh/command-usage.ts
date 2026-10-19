import { canonical_command, COMMAND_MAP } from './josh-command-map'
import type { CommandUsage } from './josh-command-types'
import { AUTOMATION_USAGE } from './josh-usage-automation'
import { BACKLOG_USAGE } from './josh-usage-backlog'
import { DEVELOPER_USAGE } from './josh-usage-developer'
import { HOOK_USAGE } from './josh-usage-hooks'
import { ISSUE_USAGE } from './josh-usage-issue'
import { REVIEW_USAGE } from './josh-usage-review'
import { RUN_USAGE } from './josh-usage-run'
import { SESSION_USAGE } from './josh-usage-session'
import { WORKFLOW_USAGE } from './josh-usage-workflow'

// The single renderer of a command's usage. `josh help <command>` prints it and
// `tools/document/generate-command-usage.ts` writes it between a reference page's usage markers,
// so the terminal and the page are one text (#3932).

type UsageTable = Readonly<Record<string, CommandUsage>>

// Which reference page renders each usage table — the one place a table is tied to its page, so the
// generator's coverage check and `josh help` read the same set (#3981).
/* eslint-disable @typescript-eslint/naming-convention */
const USAGE_PAGE_TABLES: Readonly<Record<string, ReadonlyArray<UsageTable>>> = {
	'docs/josh-commands.md': [DEVELOPER_USAGE],
	'docs/josh-commands-run.md': [RUN_USAGE, SESSION_USAGE],
	'docs/josh-commands-backlog.md': [ISSUE_USAGE, BACKLOG_USAGE, REVIEW_USAGE],
	'docs/josh-commands-automation.md': [AUTOMATION_USAGE, WORKFLOW_USAGE, HOOK_USAGE],
}
/* eslint-enable @typescript-eslint/naming-convention */
const COMMAND_USAGE: UsageTable = Object.fromEntries(
	Object.values(USAGE_PAGE_TABLES)
		.flat()
		.flatMap((table) => Object.entries(table)),
)
const NOTE_GAP = 3

interface ExampleLine {
	command: string
	note: string | undefined
}

function usage_for(name: string): CommandUsage | undefined {
	return Object.hasOwn(COMMAND_USAGE, name) ? COMMAND_USAGE[name] : undefined
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

// `josh help <command>`: the synopsis line, the description, then the usage block when the command
// has one. An alias resolves to its command; a name that is neither answers `undefined`.
function format_command_help(input: string): string | undefined {
	const name = canonical_command(input)
	const entry = Object.hasOwn(COMMAND_MAP, name) ? COMMAND_MAP[name] : undefined
	if (entry === undefined) return undefined
	const [synopsis] = entry.reference
	const head = synopsis ? `josh ${name} ${synopsis}` : `josh ${name}`
	const usage = format_usage(name)

	return [head, '', entry.description, ...(usage === undefined ? [] : ['', usage])].join('\n')
}

// The commands whose usage blocks a reference page renders — the keys of the tables tied to it.
function page_commands(page: string): Array<string> {
	const tables = Object.hasOwn(USAGE_PAGE_TABLES, page) ? USAGE_PAGE_TABLES[page] : undefined

	return (tables ?? []).flatMap((table) => Object.keys(table))
}

const command_usage = {
	USAGE_PAGES: Object.keys(USAGE_PAGE_TABLES),
	format_command_help,
	format_usage,
	page_commands,
}

export { command_usage }
