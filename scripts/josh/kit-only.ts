import { COMMAND_MAP } from './josh-command-map'
import type { CommandEntry } from './josh-command-types'

// The commands marked `is_kit_only` in the map only make sense inside the kit repository itself, so a
// consumer never sees them in `josh --help` and is refused with guidance when it runs one
// (joshuafolkken/kit#1988). The flag lives on the entry; everything a reader needs to act on it is
// here, so the help filter, the dispatch guard and the distributed-doc test read one definition.

// Where a consumer is told to go. A script-emitted string, so it stays English (`CLAUDE.md` →
// content rules) even when the session language is not.
function kit_only_notice(cmd: string): string {
	return `\`josh ${cmd}\` is a kit-only command — run it from the kit repository (joshuafolkken/kit), not from a consumer project.`
}

function is_kit_only(entry: CommandEntry): boolean {
	return entry.is_kit_only === true
}

// Every kit-only command name, for the test that pins that no distributed procedure document names
// one as an execution step.
function kit_only_command_names(): ReadonlyArray<string> {
	return Object.entries(COMMAND_MAP)
		.filter(([, entry]) => is_kit_only(entry))
		.map(([name]) => name)
}

const kit_only = {
	is_kit_only,
	command_names: kit_only_command_names,
	notice: kit_only_notice,
}

export { kit_only }
