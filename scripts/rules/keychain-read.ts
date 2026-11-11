import { direct_pr_create } from './direct-pr-create'
import type { ProgramCall } from './git-argv'

// A `security` call that takes a secret out of the macOS keychain. An unattended agent's `gh` and
// Claude Code credentials live there; `gh` reads them in its own process and never runs `security`,
// so refusing the CLI costs kit nothing (joshuafolkken/kit#7198).

const SECURITY_COMMAND = 'security'
// `-p <prompt>` is the only global option that takes a value.
const GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set(['-p'])
// `-i` reads subcommands from stdin, so any of the ones below can arrive that way.
const INTERACTIVE_FLAG = '-i'
// The subcommands that print or export a stored secret.
const SECRET_SUBCOMMANDS: ReadonlySet<string> = new Set([
	'dump-keychain',
	'export',
	'export-identities',
	'find-generic-password',
	'find-internet-password',
])

function global_flags(args: ReadonlyArray<string>): ReadonlyArray<string> {
	const [subcommand] = direct_pr_create.positional_words(args, GLOBAL_VALUE_FLAGS)
	const end = subcommand === undefined ? args.length : args.indexOf(subcommand)

	return args.slice(0, end)
}

function is_keychain_read(_segment: string, call: ProgramCall): boolean {
	if (call.name !== SECURITY_COMMAND) return false
	if (global_flags(call.args).includes(INTERACTIVE_FLAG)) return true

	const [subcommand = ''] = direct_pr_create.positional_words(call.args, GLOBAL_VALUE_FLAGS)

	return SECRET_SUBCOMMANDS.has(subcommand)
}

const keychain_read = { is_keychain_read }

export { keychain_read }
