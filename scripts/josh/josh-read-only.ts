import { canonical_command } from './josh-aliases'
import { COMMAND_MAP, type CommandEntry } from './josh-command-map'

// Whether a `josh` invocation only reads (joshuafolkken/kit#5793) — the one place a scope that may
// not implement asks, so a read-only command passes without being listed there one by one.

// `--help` and `-h` request the listing just as `help` does, so they must reach stdout independently
// of the unknown-command diagnostic on stderr (#825).
const HELP_COMMANDS: ReadonlySet<string> = new Set(['help', '--help', '-h'])
// `josh --all` (and `josh --help --all`) lists every command available in this checkout.
// A bare `--all` in the command slot is a help request, not a command.
const ALL_FLAG = '--all'

// No command, `--all` or a help spelling: `josh` prints usage and runs nothing.
function is_help_request(command: string | undefined): boolean {
	return command === undefined || command === ALL_FLAG || HELP_COMMANDS.has(command)
}

// `Object.hasOwn`, so a name spelled like an `Object.prototype` member is no command.
function entry_of(command: string): CommandEntry | undefined {
	return Object.hasOwn(COMMAND_MAP, command) ? COMMAND_MAP[command] : undefined
}

// An invocation carrying a flag its entry declares read-only.
function has_read_only_flag(entry: CommandEntry, rest: ReadonlyArray<string>): boolean {
	const flags = entry.read_only_flags ?? []

	return rest.some((argument) => flags.includes(argument))
}

// `undefined` when the invocation only reads; otherwise the rule it failed and where its usage is.
function refusal(args: ReadonlyArray<string>): string | undefined {
	const [command = '', ...rest] = args
	if (is_help_request(args[0])) return undefined

	const entry = entry_of(canonical_command(command))
	if (entry !== undefined && has_read_only_flag(entry, rest)) return undefined

	return `\`josh ${command}\` is not read-only: it is no help request and carries no read-only flag its entry declares; read its usage with \`pnpm josh help ${command}\``
}

const josh_read_only = { ALL_FLAG, is_help_request, refusal }

export { josh_read_only }
