import { fileURLToPath } from 'node:url'
import { cli_body } from '#scripts/josh/cli-body'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { issue_consolidate, type ConsolidateRequest } from './issue-consolidate'
import { issue_number_shape } from './issue-number-shape'

const USAGE =
	'Usage: josh issue:consolidate <target> <duplicate>... [--title <title>] [--body-file <path>] [--demote]'
const FAILURE = 1
const ARGV_OFFSET = 2

const OPTIONS = {
	'body-file': { type: 'string' },
	title: { type: 'string' },
	demote: { type: 'boolean' },
} as const

// Every positional an issue number, the target not among the duplicates, and none named twice — a
// repeat would close an issue that is already closed and report it as a failure.
function issue_numbers_of(positionals: ReadonlyArray<string>): ReadonlyArray<number> | undefined {
	if (positionals.some((value) => !issue_number_shape.is_issue_number(value))) return undefined
	const numbers = positionals.map(Number)

	return new Set(numbers).size === numbers.length ? numbers : undefined
}

// A flag given blank refuses rather than being dropped: the caller meant to write something.
function text_of(value: string | undefined): string | undefined {
	if (value === undefined) return undefined
	if (value.trim().length === 0) throw new Error(USAGE)

	return value
}

function issues_of(
	positionals: ReadonlyArray<string>,
): Pick<ConsolidateRequest, 'target' | 'duplicates'> {
	const [target, ...duplicates] = issue_numbers_of(positionals) ?? []

	if (target === undefined || duplicates.length === 0) throw new Error(USAGE)

	return { target, duplicates }
}

function body_of(body_file: string | undefined): string | undefined {
	return body_file === undefined ? undefined : text_of(cli_body.read_file_or_stdin(body_file))
}

function request_of(argv: ReadonlyArray<string>): ConsolidateRequest {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined) throw new Error(USAGE)

	return {
		...issues_of(parsed.positionals),
		title: text_of(parsed.values.title)?.trim(),
		body: body_of(text_of(parsed.values['body-file'])),
		is_demote: parsed.values.demote === true,
	}
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	try {
		return await issue_consolidate.consolidate(request_of(argv))
	} catch (error) {
		console.error(error_text.message_of(error))

		return FAILURE
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_consolidate_cli = { main, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_consolidate_cli }
