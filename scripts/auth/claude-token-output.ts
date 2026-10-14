import { stripVTControlCharacters } from 'node:util'

// What `claude setup-token` printed, split into the token and the text that may be shown: the token
// is replaced, so it reaches neither the screen nor a log.

const REDACTED = '[REDACTED]'
const TOKEN_START = 'sk-ant-oat'
const TOKEN_PATTERN = /sk-ant-oat\d+-[\w-]+/u
const EVERY_TOKEN_PATTERN = new RegExp(TOKEN_PATTERN.source, 'gu')
// A narrow terminal wraps the token onto lines of its own characters alone, so a continuation is a
// whole such line and the prose after the token never joins it.
const CONTINUATION_PATTERN = /^[\w-]+$/u
const LINE_BREAK_PATTERN = /\r?\n/u

interface Captured {
	token: string | undefined
	shown: string
}

// A line that starts a token is another copy of it, never the tail of the one before.
function is_continuation(line: string): boolean {
	return CONTINUATION_PATTERN.test(line) && !line.startsWith(TOKEN_START)
}

function continuation(lines: ReadonlyArray<string>): Array<string> {
	const length = lines.findIndex((line) => !is_continuation(line.trim()))

	return (length === -1 ? lines : lines.slice(0, length)).map((line) => line.trim())
}

// Every copy of the token is replaced, its wrapped tail with it: Ink may draw it in more than one frame.
function redact(lines: ReadonlyArray<string>): Array<string> {
	const start = lines.findIndex((line) => TOKEN_PATTERN.test(line))

	if (start === -1) return [...lines]

	const [head = '', ...rest] = lines.slice(start)
	const remaining = rest.slice(continuation(rest).length)

	return [
		...lines.slice(0, start),
		head.replaceAll(EVERY_TOKEN_PATTERN, () => REDACTED),
		...redact(remaining),
	]
}

function capture(output: string): Captured {
	const lines = stripVTControlCharacters(output).split(LINE_BREAK_PATTERN)
	const start = lines.findIndex((line) => TOKEN_PATTERN.test(line))
	const head = lines[start]
	const shown = redact(lines).join('\n')

	if (head === undefined) return { token: undefined, shown }

	const token = [TOKEN_PATTERN.exec(head)?.[0], ...continuation(lines.slice(start + 1))].join('')

	return { token, shown }
}

// How much of the output so far may be shown as it arrives — the sign-in URL and any prompt come
// before the token: everything before the token, less a tail that could be the start of one.
function live_length(output: string): number {
	const start = output.indexOf(TOKEN_START)

	if (start !== -1) return start

	const prefixes = Array.from({ length: TOKEN_START.length }, (_, index) =>
		TOKEN_START.slice(0, index + 1),
	)
	const held = prefixes.findLast((prefix) => output.endsWith(prefix))

	return output.length - (held?.length ?? 0)
}

const claude_token_output = { capture, live_length }

export { claude_token_output }
export type { Captured }
