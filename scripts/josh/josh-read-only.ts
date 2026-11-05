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

// The registry entry a typed name runs, an alias by the command it expands to. `Object.hasOwn`, so a
// name spelled like an `Object.prototype` member is no command.
function entry_of(name: string): CommandEntry | undefined {
	const command = canonical_command(name)

	return Object.hasOwn(COMMAND_MAP, command) ? COMMAND_MAP[command] : undefined
}

// An invocation of an entry declared read-only whole, or carrying a flag its entry declares read-only.
function is_read_only_call(entry: CommandEntry, rest: ReadonlyArray<string>): boolean {
	const write_flags = entry.write_flags ?? []
	if (rest.some((argument) => write_flags.includes(argument.split('=', 1)[0] ?? ''))) return false
	if (entry.is_read_only === true) return true

	const flags = entry.read_only_flags ?? []

	return rest.some((argument) => flags.includes(argument))
}

// `undefined` when the invocation only reads; otherwise the rule it failed and where its usage is.
function refusal(args: ReadonlyArray<string>): string | undefined {
	const [command = '', ...rest] = args
	if (is_help_request(args[0])) return undefined

	const entry = entry_of(command)
	if (entry !== undefined && is_read_only_call(entry, rest)) return undefined

	return `\`josh ${command}\` is not read-only: it carries a declared write flag, or its entry is not declared read-only and it carries no read-only flag its entry declares; read its usage with \`pnpm josh help ${command}\``
}

const josh_read_only = { ALL_FLAG, entry_of, is_help_request, refusal }

export { josh_read_only }
