import { status_icons } from '#scripts/lib/status-icons'
import { gate_log } from './gate-log'

// The end every josh verification check prints, in one place (joshuafolkken/kit#5162).
//
// **A run pipes a check into `tail` because the end is the answer.** Over 4,145 piped calls, 85% were a
// `tail -N` and most of the rest a `grep` for `FAIL`, `error` or a `✓`/`✗` — the run wanted to know
// whether the check passed and what to look at if it did not. `josh gate` already ended that way, while
// `lint:related` printed no verdict at all and `test:related` printed one only on a failure, so the run
// kept inventing the filter. Every check now ends with the same three parts, built here:
//
// 1. what failed and what to run next — nothing on a green run;
// 2. where the whole output was kept (`gate-log.ts`), for a check that keeps one;
// 3. the verdict, always the last line, for the reason `josh-verdict.ts` gives.

const { FAIL_ICON, PASS_ICON } = status_icons

// Where the whole output went: `path` is `undefined` when the write failed, which the notice says.
interface KeptLog {
	path: string | undefined
}

interface VerificationTail {
	// The lines above the log notice, each ending in a newline; empty on a green run.
	failures: string
	// Absent where the console is the only copy of the output.
	log?: KeptLog | undefined
	verdict: string
}

// `✓ <command> passed` or `✗ <command> failed: <what failed>`.
function format_verdict(command: string, failed: ReadonlyArray<string>): string {
	if (failed.length === 0) return `${PASS_ICON} ${command} passed`

	return `${FAIL_ICON} ${command} failed: ${failed.join(', ')}`
}

// One failure and the command that reproduces it, as `josh gate` names its failed checks.
function format_rerun(label: string, command: string): string {
	return `  ${FAIL_ICON} ${label} — re-run: ${command}`
}

function format_tail(tail: VerificationTail): string {
	const notice = tail.log === undefined ? '' : gate_log.format_log_notice(tail.log.path)

	return `${tail.failures}${notice}${tail.verdict}\n`
}

const verification_tail = { format_rerun, format_tail, format_verdict }

export type { KeptLog, VerificationTail }
export { verification_tail }
