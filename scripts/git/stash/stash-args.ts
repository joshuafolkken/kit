import { cli_flags } from '#scripts/lib/cli-flags'

// `josh stash:push` and `josh stash:pop` turn their `argv` into a single request: the message of the
// stash to push or pop. Parsing lives here, acting on the stack lives in each command's cli, and a
// malformed command line is `undefined` rather than a guessed intent — a pop run on a misread argument
// would take the wrong entry off a stack shared by every lane, and a push without its message would
// leave an entry nothing can target.

// `--dir` points the command at a lane's work tree; without it, it acts on the current checkout.
const OPTIONS = { dir: { type: 'string' } } as const

interface ParsedValues {
	values: { dir?: string }
	positionals: ReadonlyArray<string>
}

interface Request {
	message: string
	dir: string | undefined
}

function usage(command: string): string {
	return `Usage: josh ${command} "<message>" [--dir <path>]`
}

function read_arguments(argv: ReadonlyArray<string>): ParsedValues | undefined {
	return cli_flags.arguments_of(argv, OPTIONS)
}

// The message is the sole positional and must be a non-empty string: an empty message matches every
// stash pushed without a message, which is exactly the ambiguity `stash:pop` exists to refuse.
function message_of(positionals: ReadonlyArray<string>): string | undefined {
	if (positionals.length !== 1) return undefined

	const [message] = positionals

	return message === '' ? undefined : message
}

function to_request(parsed: ParsedValues): Request | undefined {
	const message = message_of(parsed.positionals)

	if (message === undefined) return undefined

	return { message, dir: parsed.values.dir }
}

const stash_args = { read_arguments, to_request, usage }

export type { Request }
export { stash_args }
