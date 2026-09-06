// The shape an issue number may take where a `run:*` command interpolates it, and the refusal when
// it does not (joshuafolkken/kit#1485).
//
// It sits in its own module because two commands need the same answer and a rule copied into two
// files is a rule kept correct in one. `run:preflight` interpolates the number into a double-quoted
// shell command a caller is told to paste; `run:liveness` interpolates it into the same kind of
// recovery advice, and reads GitHub with it. Both refuse before the interpolation rather than
// leaving the check to whichever entry point remembered.

const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const BAD_ISSUE_MESSAGE = 'Not an issue number: '

function require_issue_number(issue: string): void {
	if (!ISSUE_NUMBER_PATTERN.test(issue)) throw new Error(`${BAD_ISSUE_MESSAGE}${issue}`)
}

const run_issue_number = { BAD_ISSUE_MESSAGE, ISSUE_NUMBER_PATTERN, require_issue_number }

export { run_issue_number }
