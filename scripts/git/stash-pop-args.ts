import { parseArgs } from 'node:util'

// `josh stash:pop` turns its `argv` into a single request: the message of the stash to pop. Parsing
// lives here, acting on the stack lives in `stash-pop-cli.ts`, and a malformed command line is
// `undefined` rather than a guessed intent — a pop run on a misread argument would take the wrong
// entry off a stack shared by every lane (joshuafolkken/kit#2050).

const USAGE = 'Usage: josh stash:pop "<message>" [--dir <path>]'

// `--dir` points the pop at a lane's work tree; without it the pop lands in the current checkout.
const OPTIONS = { dir: { type: 'string' } } as const

interface ParsedValues {
	values: { dir?: string }
	positionals: ReadonlyArray<string>
}

interface Request {
	message: string
	dir: string | undefined
}

function read_arguments(argv: ReadonlyArray<string>): ParsedValues | undefined {
	try {
		const parsed = parseArgs({
			args: [...argv],
			options: OPTIONS,
			strict: true,
			allowPositionals: true,
		})

		return { values: parsed.values, positionals: parsed.positionals }
	} catch {
		return undefined
	}
}

// The message is the sole positional and must be a non-empty string: an empty message matches every
// stash pushed without a message, which is exactly the ambiguity this command exists to refuse.
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

const stash_pop_args = { USAGE, message_of, read_arguments, to_request }

export type { Request }
export { stash_pop_args }
