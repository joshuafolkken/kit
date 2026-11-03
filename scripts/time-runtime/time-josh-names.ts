import { canonical_command } from '#scripts/josh/josh-aliases'
import { time_shell } from '#scripts/time-runtime/time-shell'

// The josh names `time_shell` reads, alias-expanded — the one layer a reader that matches a name
// against canonical ones goes through (joshuafolkken/kit#6161). `time_shell` still expands today;
// `canonical_command` is idempotent, so routing a reader here changes nothing until #6159 moves the
// expansion out of `time_shell` and leaves it to this layer alone.

// `josh <name>` or `josh <name> <arguments>…` with the subcommand expanded; the arguments are kept
// verbatim, and `''` (a segment that runs no josh command) stays `''`.
function canonical_name(name: string): string {
	if (name === '') return ''

	const [subcommand = '', ...rest] = name.slice(time_shell.JOSH_PREFIX.length).split(' ')

	return [`${time_shell.JOSH_PREFIX}${canonical_command(subcommand)}`, ...rest].join(' ')
}

function josh_command_of(command: string): string {
	return canonical_name(time_shell.josh_command_of(command))
}

function josh_command_of_segment(segment: string): string {
	return canonical_name(time_shell.josh_command_of_segment(segment))
}

function josh_commands_of(command: string): Array<string> {
	return time_shell.josh_commands_of(command).map((name) => canonical_name(name))
}

function josh_signatures_of(command: string): Array<string> {
	return time_shell.josh_signatures_of(command).map((signature) => canonical_name(signature))
}

const time_josh_names = {
	josh_command_of,
	josh_command_of_segment,
	josh_commands_of,
	josh_signatures_of,
}

export { time_josh_names }
