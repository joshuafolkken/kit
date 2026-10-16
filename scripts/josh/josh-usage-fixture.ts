import { COMMAND_MAP } from './josh-command-map'
import type { CommandUsage } from './josh-command-types'

type UsageTable = Readonly<Record<string, CommandUsage>>

// The checks every usage table shares: it names only registered commands, and every command has an
// example for its usage block to render. Each answers the offending names, so a pass is `[]`.
function unregistered_commands(table: UsageTable): Array<string> {
	return Object.keys(table).filter((name) => !Object.hasOwn(COMMAND_MAP, name))
}

function commands_without_examples(table: UsageTable): Array<string> {
	return Object.entries(table)
		.filter(([, usage]) => usage.examples.length === 0)
		.map(([name]) => name)
}

const usage_table_checks = { commands_without_examples, unregistered_commands }

export { usage_table_checks }
