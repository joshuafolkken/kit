import { stripVTControlCharacters } from 'node:util'
import { gate_log } from '#scripts/gate/gate-log'
import { verification_tail } from '#scripts/gate/verification-tail'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'

// A failed vitest run's answer, put where a `tail` reaches it (joshuafolkken/kit#4869).
//
// **The console's end is the last failure's stack, not the list of what failed.** vitest prints its
// failures in order and then a summary of counts, so `josh test:related 2>&1 | tail -40` kept one stack
// and no names, and the only way to learn the rest was to run the suite again. So every run's output
// goes to a file, and a failed one ends with the failed tests' names and that file's path — the same
// log and notice `josh gate` uses, imported rather than re-derived.

const UNIT_LOG_PREFIX = 'josh-unit-log-'
const UNIT_LOG_HEADER = 'vitest'
const FAILED_LINE = /^FAIL\s+(?<name>\S.*)$/u
const FAILED_HEADING = 'failed tests:'
const NONE_NAMED = '  (none named in the output — read the full output)'
const NONE_NAMED_VERDICT = 'none named'
// A name is `<file> > <suite> > <test>` or `<file> [ <file> ]`, prefixed `|<project>| ` in a workspace.
const FAILED_FILE = /^(?:\|[^|]*\|\s+)?(?<file>\S+)/u
// The guarded unit run, filtered to those files: it reserves its cores and ends a failure with this
// same summary (joshuafolkken/kit#5023).
const RERUN_PREFIX = 'rerun failed: pnpm josh test:unit '

// One path per checkout and vitest mode, overwritten by each run, beside the gate's own log. **The
// mode is in the name** because the gate's whole-suite `run` and a `related` run started beside it
// overlap, and one shared file would hand the failed run's reader the other run's output.
function unit_log_path(vitest_arguments: ReadonlyArray<string>): string {
	const prefix = `${UNIT_LOG_PREFIX}${vitest_arguments[0] ?? UNIT_LOG_HEADER}-`

	return stamp_file.stamp_path(prefix, PROJECT_ROOT, gate_log.GATE_LOG_SUFFIX)
}

function failed_name(line: string): string | undefined {
	return FAILED_LINE.exec(stripVTControlCharacters(line).trim())?.groups?.['name']
}

// vitest names each failed test on a ` FAIL  <file> > <suite> > <test>` line, and a file that could
// not load on ` FAIL  <file> [ <file> ]`. A name printed twice is listed once.
function failed_tests(output: string): ReadonlyArray<string> {
	const names = output.split('\n').map((line) => failed_name(line))

	return [...new Set(names.filter((name) => name !== undefined))]
}

// The files the failed names belong to, each once — what to run after a fix, before the whole related
// set again (joshuafolkken/kit#5023).
function failed_files(names: ReadonlyArray<string>): ReadonlyArray<string> {
	const files = names.map((name) => FAILED_FILE.exec(name)?.groups?.['file'])

	return [...new Set(files.filter((file) => file !== undefined))]
}

function name_lines(names: ReadonlyArray<string>): ReadonlyArray<string> {
	if (names.length === 0) return [NONE_NAMED]

	return [...names.map((name) => `  ${name}`), `${RERUN_PREFIX}${failed_files(names).join(' ')}`]
}

// The verdict names the failed files, so the last line alone says what to fix (joshuafolkken/kit#5162).
function format_failure_summary(
	output: string,
	log_path: string | undefined,
	label: string = UNIT_LOG_HEADER,
): string {
	const names = failed_tests(output)
	const failures = `${[FAILED_HEADING, ...name_lines(names)].join('\n')}\n`
	const failed = names.length === 0 ? [NONE_NAMED_VERDICT] : failed_files(names)
	const verdict = verification_tail.format_verdict(label, failed)

	return verification_tail.format_tail({ failures, log: { path: log_path }, verdict })
}

function format_green_summary(log_path: string | undefined, label: string): string {
	const verdict = verification_tail.format_verdict(label, [])

	return verification_tail.format_tail({ failures: '', log: { path: log_path }, verdict })
}

// Written on every run, as the gate's is, headed by the run's own invocation, and ended as every josh
// check ends (`verification-tail.ts`): a green run's last line is its verdict, not vitest's counts.
function report(
	vitest_arguments: ReadonlyArray<string>,
	output: string,
	exit_code: number,
	target: string = unit_log_path(vitest_arguments),
): void {
	const header = [UNIT_LOG_HEADER, ...vitest_arguments].join(' ')
	const log_path = gate_log.write_gate_log([{ header, output }], target)
	const label = [UNIT_LOG_HEADER, ...vitest_arguments.slice(0, 1)].join(' ')
	const summary =
		exit_code === 0
			? format_green_summary(log_path, label)
			: format_failure_summary(output, log_path, label)

	process.stdout.write(summary)
}

const vitest_failure_summary = {
	RERUN_PREFIX,
	failed_files,
	failed_tests,
	format_failure_summary,
	report,
	unit_log_path,
}

export { vitest_failure_summary }
