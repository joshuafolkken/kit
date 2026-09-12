import { parseArgs } from 'node:util'
import { run_issue_number } from './run-issue-number'

// `josh run:cut` turns its `argv` into one of four requests. The contract mirrors `run-carry-args.ts`:
// parsing lives here, acting on the record lives in `run-cut-cli.ts`, and a malformed command line is
// `undefined` rather than a guessed intent — a cut that ran on a misread flag would end a process at
// the wrong moment.

const USAGE = 'Usage: josh run:cut <issue> | --resume <issue> | --json | --end'

const OPTIONS = {
	end: { type: 'boolean' },
	json: { type: 'boolean' },
	resume: { type: 'boolean' },
} as const

interface ParsedValues {
	values: { end?: boolean; json?: boolean; resume?: boolean }
	positionals: ReadonlyArray<string>
}

type Request =
	| { kind: 'cut'; issue: string }
	| { kind: 'resume'; issue: string }
	| { kind: 'read' }
	| { kind: 'end' }

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

// The issue is the sole positional, and it must be a real issue number: a cut relaunches
// `fullrun #<issue>`, so a value that skipped validation would reach a detached agent invocation.
function issue_of(positionals: ReadonlyArray<string>): string | undefined {
	const [issue] = positionals

	if (issue === undefined) return undefined

	try {
		run_issue_number.require_issue_number(issue)
	} catch {
		return undefined
	}

	return issue
}

// The four modes are mutually exclusive; more than one flag is a refusal rather than a precedence
// order the caller has to remember.
function is_single_mode(values: ParsedValues['values']): boolean {
	const flags = [values.end, values.json, values.resume].filter(Boolean)

	return flags.length <= 1
}

function issue_request(
	kind: 'cut' | 'resume',
	positionals: ReadonlyArray<string>,
): Request | undefined {
	const issue = issue_of(positionals)

	return issue === undefined ? undefined : { kind, issue }
}

function to_request(parsed: ParsedValues): Request | undefined {
	if (!is_single_mode(parsed.values)) return undefined

	if (parsed.values.end === true) return { kind: 'end' }

	if (parsed.values.json === true) return { kind: 'read' }

	if (parsed.values.resume === true) return issue_request('resume', parsed.positionals)

	return issue_request('cut', parsed.positionals)
}

const run_cut_args = { USAGE, issue_of, read_arguments, to_request }

export type { Request }
export { run_cut_args }
