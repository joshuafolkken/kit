// The shape an issue number may take, and the refusal when it does not — the one declaration every
// command reads.
//
// It sits in its own module because a rule copied into two files is a rule kept correct in one: a
// copy that read `/^\d+$/u` accepted issue `0` and a leading zero where every other command refused
// them. A command that interpolates the number into a shell command a caller is told to paste, a
// GitHub path, a branch or a lane directory refuses before the interpolation rather than leaving the
// check to whichever entry point remembered.
//
// `ISSUE_NUMBER_PATTERN` stays exported beside `is_issue_number`: a taint analyzer credits a literal
// pattern test in the expression that returns the value as a sanitizer, but not one reached through a
// call (`run-merge-cli.ts`).

const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const BAD_ISSUE_MESSAGE = 'Not an issue number: '

function is_issue_number(value: string): boolean {
	return ISSUE_NUMBER_PATTERN.test(value)
}

function require_issue_number(issue: string): void {
	if (!is_issue_number(issue)) throw new Error(`${BAD_ISSUE_MESSAGE}${issue}`)
}

// A command whose one positional is the issue it writes to: a missing, malformed or second number
// answers `undefined`, so the caller refuses the whole call rather than writing to some other issue.
function single_of(positionals: ReadonlyArray<string>): string | undefined {
	const [issue_number, ...rest] = positionals
	const is_single = rest.length === 0 && issue_number !== undefined

	return is_single && ISSUE_NUMBER_PATTERN.test(issue_number) ? issue_number : undefined
}

const issue_number_shape = {
	ISSUE_NUMBER_PATTERN,
	is_issue_number,
	require_issue_number,
	single_of,
}

export { issue_number_shape }
