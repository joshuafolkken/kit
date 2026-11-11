import type { ProgramCall } from './git-argv'

// A `security` call that takes a secret out of the macOS keychain. An unattended agent's `gh` and
// Claude Code credentials live there; `gh` reads them in its own process and never runs `security`,
// so refusing the CLI costs kit nothing (joshuafolkken/kit#7198).

const SECURITY_COMMAND = 'security'
const FLAG_PREFIX = '-'
// Global short options cluster (`-qi`, `-qp <prompt>`, `-pPROMPT`). `-p` is the only one that takes
// a value: the rest of its word, or the next word when nothing follows it.
const PROMPT_FLAG = 'p'
const STEP = 1
const VALUE_STEP = 2
// `-i` reads subcommands from stdin, so any of the ones below can arrive that way.
const INTERACTIVE_FLAG = 'i'
// The subcommands that print or export a stored secret.
const SECRET_SUBCOMMANDS: ReadonlySet<string> = new Set([
	'dump-keychain',
	'export',
	'export-identities',
	'find-generic-password',
	'find-internet-password',
])

interface GlobalOptions {
	is_interactive: boolean
	// The index of the subcommand: the first word past the options and the prompt they name.
	subcommand: number
}

interface Cluster {
	// The letters before `p`; the ones after it are the prompt.
	flags: string
	// The words the cluster spans: two when `p` ends it and the prompt is the next word.
	step: number
}

function cluster_of(word: string): Cluster {
	const letters = word.slice(FLAG_PREFIX.length)
	const prompt_at = letters.indexOf(PROMPT_FLAG)

	if (prompt_at === -1) return { flags: letters, step: STEP }

	const step = prompt_at === letters.length - 1 ? VALUE_STEP : STEP

	return { flags: letters.slice(0, prompt_at), step }
}

function global_options(args: ReadonlyArray<string>): GlobalOptions {
	const [word = ''] = args

	if (!word.startsWith(FLAG_PREFIX)) return { is_interactive: false, subcommand: 0 }

	const { flags, step } = cluster_of(word)
	const rest = global_options(args.slice(step))

	return {
		is_interactive: flags.includes(INTERACTIVE_FLAG) || rest.is_interactive,
		subcommand: step + rest.subcommand,
	}
}

function is_keychain_read(_segment: string, call: ProgramCall): boolean {
	if (call.name !== SECURITY_COMMAND) return false

	const { is_interactive, subcommand } = global_options(call.args)

	return is_interactive || SECRET_SUBCOMMANDS.has(call.args[subcommand] ?? '')
}

const keychain_read = { is_keychain_read }

export { keychain_read }
