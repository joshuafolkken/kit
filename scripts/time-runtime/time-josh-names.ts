import { canonical_command } from '#scripts/josh/josh-aliases'
import { time_shell } from '#scripts/time-runtime/time-shell'

// The josh names `time_shell` reads, alias-expanded — the one layer that expands them, and the one a
// reader that matches a name against canonical ones goes through (joshuafolkken/kit#6161). `time_shell`
// returns the names as typed, so it does not import `josh-aliases.ts` (joshuafolkken/kit#6159).
//
// **An alias is expanded, so one command is one name.** Every reading keyed on the raw name took
// `pnpm josh ga` and `pnpm josh gate` as two different commands: the per-command table printed them
// as two rows, the per-invocation table dropped both for having one call each, and — the one with
// real cost — the failure chain did not see the second as answering the first, so the time a red gate
// made the run pay again went unreported.
//
// **The expansion belongs at the name, not at each reader.** A gate-run reader had once patched its
// own copy of this reading, which left the gate count and the per-invocation table answering
// differently about the same run; `canonical_command` here is the one rule every reader goes through.

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
