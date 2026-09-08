// One parser for every consumer: `--issue-number` is a free-form string, and `Number('42a')` is
// NaN — which compares unequal to every issue number and would silently disable the
// just-completed-issue exclusion. `parse_issue_number_from_text` accepts every shape the positional
// does (`42`, `#42`, a title ending in `#42`) and guarantees digits-only output, so the command line
// and the run's tail cannot disagree about what "the completed issue" is.
//
// It sits in a module of its own because both consumers need it and neither may import the other:
// the tail reads it to record a run, and the entry point reads it to build one
// (joshuafolkken/kit#1539).
function parse_issue_number_from_text(input: string | undefined): string | undefined {
	if (input === undefined) return undefined
	const trimmed = input.trim()
	const direct_match = /^#?(\d+)$/u.exec(trimmed)
	if (direct_match?.[1] !== undefined) return direct_match[1]
	const title_match = /#(\d+)$/u.exec(trimmed)

	return title_match?.[1]
}

function parse_completed_issue_number(raw: string | undefined): number | undefined {
	const digits = parse_issue_number_from_text(raw)

	return digits === undefined ? undefined : Number(digits)
}

const followup_issue_number = {
	parse_issue_number_from_text,
	parse_completed_issue_number,
}

export { followup_issue_number, parse_issue_number_from_text, parse_completed_issue_number }
