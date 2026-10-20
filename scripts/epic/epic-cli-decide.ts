import { epic_cli_argv, type FormFlags } from './epic-cli-argv'

// `josh epic --decide <E> <N...> --decision-file <path|->`'s argument rules — a decision about children
// the epic already tracks, which `--add --decision-file` refuses as an insertion with nothing to add.
//
// Its own module for the reason `--remove` has one: `epic-cli.ts` sits at its line ceiling.

const DECIDE_FLAG = '--decide'
const DECISION_FLAG = '--decision-file'
const DECIDE_FORM: FormFlags = { switches: [DECIDE_FLAG], value_flags: [DECISION_FLAG] }

interface DecideArguments {
	epic_number: number
	children: Array<number>
	decision_path: string
}

// Whether the invocation records a decision rather than creating, promoting or editing the epic.
function is_decision_entry(argv: ReadonlyArray<string>): boolean {
	return argv.includes(DECIDE_FLAG)
}

// The record is the whole point of the form, so a missing or unusable `--decision-file` refuses it
// rather than reading as "nothing to record".
function parse_decide_arguments(argv: ReadonlyArray<string>): DecideArguments | undefined {
	if (epic_cli_argv.is_value_unusable(argv, DECISION_FLAG)) return undefined
	const parsed = epic_cli_argv.read_form(argv, DECIDE_FORM)
	if (parsed === undefined) return undefined
	const subject = epic_cli_argv.read_epic_children(parsed)
	const decision_path = epic_cli_argv.read_flag_value(parsed, DECISION_FLAG)
	if (subject === undefined || decision_path === undefined) return undefined

	return { ...subject, decision_path }
}

const epic_cli_decide = {
	is_decision_entry,
	parse_decide_arguments,
}

export { epic_cli_decide, DECIDE_FLAG }
export type { DecideArguments }
