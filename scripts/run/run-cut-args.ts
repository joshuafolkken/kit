import { parseArgs } from 'node:util'
import { run_issue_number } from './run-issue-number'

// `josh run:cut` turns its `argv` into one of four requests. The contract mirrors `run-carry-args.ts`:
// parsing lives here, acting on the record lives in `run-cut-cli.ts`, and a malformed command line is
// `undefined` rather than a guessed intent — a cut that ran on a misread flag would end a process at
// the wrong moment.

const USAGE = 'Usage: josh run:cut <issue> [--impl] | --resume <issue> | --json | --end'

const OPTIONS = {
	end: { type: 'boolean' },
	// The implementation-phase cut (joshuafolkken/kit#1933). It modifies the bare cut rather than being
	// a mode of its own — `run:cut --impl <issue>` still takes a cut — so it is refused only when it is
	// paired with `--resume`, `--json` or `--end`, which ask about a cut rather than take one.
	impl: { type: 'boolean' },
	json: { type: 'boolean' },
	resume: { type: 'boolean' },
} as const

interface ParsedValues {
	values: { end?: boolean; impl?: boolean; json?: boolean; resume?: boolean }
	positionals: ReadonlyArray<string>
}

type Request =
	| { kind: 'cut'; issue: string; is_implementation: boolean }
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

// The mode flags are mutually exclusive; more than one is a refusal rather than a precedence order
// the caller has to remember. `--impl` is not a mode — it modifies the bare cut — so it is refused
// only when it accompanies one of the three that ask about a cut rather than take one.
function is_single_mode(values: ParsedValues['values']): boolean {
	const modes = [values.end, values.json, values.resume].filter(Boolean)

	if (modes.length > 1) return false

	return !(values.impl === true && modes.length > 0)
}

// The cut and the resume both take the sole positional issue; the cut also carries whether `--impl`
// asked for the implementation-phase boundary, which the resume never needs.
function issue_request(
	kind: 'cut' | 'resume',
	positionals: ReadonlyArray<string>,
	is_implementation: boolean,
): Request | undefined {
	const issue = issue_of(positionals)

	if (issue === undefined) return undefined

	return kind === 'resume' ? { kind: 'resume', issue } : { kind: 'cut', issue, is_implementation }
}

function to_request(parsed: ParsedValues): Request | undefined {
	if (!is_single_mode(parsed.values)) return undefined

	if (parsed.values.end === true) return { kind: 'end' }

	if (parsed.values.json === true) return { kind: 'read' }

	const kind = parsed.values.resume === true ? 'resume' : 'cut'

	return issue_request(kind, parsed.positionals, parsed.values.impl === true)
}

const run_cut_args = { USAGE, issue_of, read_arguments, to_request }

export type { Request }
export { run_cut_args }
