import type { ProgramCall } from './git-argv'

// A `security` call that takes a secret out of the macOS keychain. An unattended agent's `gh` and
// Claude Code credentials live there; `gh` reads them in its own process and never runs `security`,
// so refusing the CLI costs kit nothing (joshuafolkken/kit#7198).

const SECURITY_COMMAND = 'security'
const FLAG_PREFIX = '-'
// Global short options cluster (`-qi`, `-qp <prompt>`). `-p <prompt>` is the only one that
// takes a value, so a cluster ending in `p` takes the next word.
const VALUE_CLUSTER = /^-[a-z]*p$/u
const STEP = 1
const VALUE_STEP = 2
// `-i` reads subcommands from stdin, so any of the ones below can arrive that way.
const INTERACTIVE_CLUSTER = /^-[a-z]*i/u
// The subcommands that print or export a stored secret.
const SECRET_SUBCOMMANDS: ReadonlySet<string> = new Set([
	'dump-keychain',
	'export',
	'export-identities',
	'find-generic-password',
	'find-internet-password',
])

// The index of the subcommand: the first word past the global options and the prompt they name.
function subcommand_index(args: ReadonlyArray<string>): number {
	let index = 0

	while (args[index]?.startsWith(FLAG_PREFIX) === true) {
		index += VALUE_CLUSTER.test(args[index] ?? '') ? VALUE_STEP : STEP
	}

	return index
}

function is_keychain_read(_segment: string, call: ProgramCall): boolean {
	if (call.name !== SECURITY_COMMAND) return false

	const index = subcommand_index(call.args)

	if (call.args.slice(0, index).some((word) => INTERACTIVE_CLUSTER.test(word))) return true

	return SECRET_SUBCOMMANDS.has(call.args[index] ?? '')
}

const keychain_read = { is_keychain_read }

export { keychain_read }
