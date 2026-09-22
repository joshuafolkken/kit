import { parseArgs } from 'node:util'
import { run_issue_number } from './run-issue-number'

// `josh run:cut` turns its `argv` into one of four requests. The contract mirrors `run-carry-args.ts`:
// parsing lives here, acting on the record lives in `run-cut-cli.ts`, and a malformed command line is
// `undefined` rather than a guessed intent — a cut that ran on a misread flag would end a process at
// the wrong moment.

const USAGE =
	'Usage: josh run:cut <issue> [--impl | --setup] [--handoff <path>] | --resume <issue> | --json | --end'

const OPTIONS = {
	end: { type: 'boolean' },
	// The path to the handoff file the cut carries — the run's instruction and work state
	// (joshuafolkken/kit#2354). A value rather than a boolean: the body is passed by path, never inlined
	// on the command line, so a backtick or `$` in the instruction is not executed. It modifies the bare
	// cut like `--impl` / `--setup`, so it is refused only when paired with a mode that asks about a cut.
	handoff: { type: 'string' },
	// The implementation-phase cut (joshuafolkken/kit#1933). It modifies the bare cut rather than being
	// a mode of its own — `run:cut --impl <issue>` still takes a cut — so it is refused only when it is
	// paired with `--resume`, `--json` or `--end`, which ask about a cut rather than take one.
	impl: { type: 'boolean' },
	json: { type: 'boolean' },
	resume: { type: 'boolean' },
	// The setup-phase cut (joshuafolkken/kit#2346). Like `--impl` it modifies the bare cut rather than
	// being a mode of its own; the two name different boundaries, so pairing them is refused.
	setup: { type: 'boolean' },
} as const

interface ParsedValues {
	values: {
		end?: boolean
		handoff?: string
		impl?: boolean
		json?: boolean
		resume?: boolean
		setup?: boolean
	}
	positionals: ReadonlyArray<string>
}

type Request =
	| {
			kind: 'cut'
			issue: string
			is_implementation: boolean
			is_setup: boolean
			handoff_path?: string | undefined
	  }
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
// the caller has to remember. `--impl`, `--setup` and `--handoff` are not modes — they modify the bare
// cut — so each is refused only when it accompanies one of the three that ask about a cut rather than
// take one, and pairing the two phase flags with each other is refused because they name different
// boundaries. `--handoff` pairs freely with a phase flag: it carries the instruction the cut records.
function is_single_mode(values: ParsedValues['values']): boolean {
	const modes = [values.end, values.json, values.resume].filter(Boolean)
	const phase_flags = [values.impl, values.setup].filter(Boolean)

	if (modes.length > 1 || phase_flags.length > 1) return false

	const has_cut_modifier = phase_flags.length > 0 || values.handoff !== undefined

	return !(has_cut_modifier && modes.length > 0)
}

// What a cut carries beyond its issue: which phase flag — `--impl` or `--setup` — named a boundary
// other than the pre-gate one, and the `--handoff` path for the instruction it carries. A resume needs
// none of it.
interface CutExtras {
	is_implementation: boolean
	is_setup: boolean
	handoff_path?: string | undefined
}

// The cut and the resume both take the sole positional issue; the cut also carries its extras.
function issue_request(
	kind: 'cut' | 'resume',
	positionals: ReadonlyArray<string>,
	extras: CutExtras,
): Request | undefined {
	const issue = issue_of(positionals)

	if (issue === undefined) return undefined

	return kind === 'resume' ? { kind: 'resume', issue } : { kind: 'cut', issue, ...extras }
}

function to_request(parsed: ParsedValues): Request | undefined {
	if (!is_single_mode(parsed.values)) return undefined

	if (parsed.values.end === true) return { kind: 'end' }

	if (parsed.values.json === true) return { kind: 'read' }

	const kind = parsed.values.resume === true ? 'resume' : 'cut'

	return issue_request(kind, parsed.positionals, {
		is_implementation: parsed.values.impl === true,
		is_setup: parsed.values.setup === true,
		handoff_path: parsed.values.handoff,
	})
}

const run_cut_args = { USAGE, issue_of, read_arguments, to_request }

export type { Request }
export { run_cut_args }
