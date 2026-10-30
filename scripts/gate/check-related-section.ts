// **Each check prints only its last lines; its whole output is in the log** (joshuafolkken/kit#5204).
// A `test:related` over hundreds of files printed past 140 KB, past the tool result's size limit, and
// the run typed the same `check:related` again behind a `grep` only to read the verdict. The end of a
// section is where a check's own verdict and its failures land, so a passed check keeps its last 5
// lines and a failed one its last 40; `--full` prints the whole output as before.

const PASSED_TAIL_LINES = 5
const FAILED_TAIL_LINES = 40
const FULL_FLAG = '--full'

const NOT_RUN = 'not run'

interface CheckResult {
	command: string
	exit_code: number
	output: string
	// A check never started because one it waits on failed (`check-related-order.ts`).
	is_skipped?: boolean
}

function result_status(result: CheckResult): string {
	if (result.is_skipped === true) return NOT_RUN

	return result.exit_code === 0 ? 'passed' : `failed (${String(result.exit_code)})`
}

function tail_lines(result: CheckResult): ReadonlyArray<string> {
	const lines = result.output.trimEnd().split('\n')
	const count = result.exit_code === 0 ? PASSED_TAIL_LINES : FAILED_TAIL_LINES
	const dropped = lines.length - count

	if (dropped <= 0) return lines

	return [`… ${String(dropped)} earlier line(s) in the log`, ...lines.slice(-count)]
}

function section_body(result: CheckResult, is_full: boolean): string {
	if (is_full) return result.output.endsWith('\n') ? result.output : `${result.output}\n`

	return `${tail_lines(result).join('\n')}\n`
}

function format_section(result: CheckResult, is_full = false): string {
	const header = `\n=== ${result.command}: ${result_status(result)} ===\n`

	if (result.output.length === 0) return header

	return `${header}${section_body(result, is_full)}`
}

function is_full_requested(arguments_: ReadonlyArray<string>): boolean {
	return arguments_.includes(FULL_FLAG)
}

const check_related_section = {
	FAILED_TAIL_LINES,
	NOT_RUN,
	format_section,
	is_full_requested,
	result_status,
}

export type { CheckResult }
export { check_related_section }
