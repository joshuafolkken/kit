import { error_text } from '#scripts/lib/error-message'

// What `run:cut`, `run:carry` and `run:hold` share about a failure nobody planned. Each of them answers
// one token on every path out, and the token alone cannot say why — so the two failures are kept
// apart here: a git directory that could not be resolved is the one case their "git directory could
// not be read" message is true of, and anything else thrown is reported with its own message.

// Only the resolution is folded into `undefined`, so the caller's unknown-git-directory message is
// printed for that path alone. `JOSH_DEBUG` keeps the reason git gave.
async function directory_of(
	where: string,
	read: () => Promise<string | undefined>,
): Promise<string | undefined> {
	try {
		return await read()
	} catch (error) {
		error_text.trace_swallowed(where, error)

		return undefined
	}
}

function message(command: string, error: unknown): string {
	return `${command} failed and established nothing: ${error_text.message_of(error)}`
}

const run_cli_fault = { directory_of, message }

export { run_cli_fault }
