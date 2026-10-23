import type { SnapshotObserver } from '#scripts/gh/git-pr-checks'
import { is_coderabbit_check, is_coderabbit_rate_limited } from '#scripts/gh/git-pr-checks-eval'
import {
	CHECK_STATUS_FAIL,
	CHECK_STATUS_PASS,
	CHECK_STATUS_PENDING,
	type PrStateSnapshot,
	type RollupCheck,
} from '#scripts/gh/git-pr-checks-parse'
import {
	run_event_checks,
	type CodeRabbitState,
	type PrChecks,
} from '#scripts/run/event/run-event-checks'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// What `followup`'s check wait tells the run's event stream (joshuafolkken/kit#3770): the CI counts and
// CodeRabbit's state, one `pr-checks` line each time they change, so `run:board` draws a child waiting
// in followup from the stream alone. CodeRabbit is counted apart — it has a state of its own and does
// not gate the merge.

const PR_NUMBER_PATTERN = /\/pull\/(?<number>\d+)/u
const { PR_CHECKS } = run_event_stream.EVENT_KIND

function count_of(checks: ReadonlyArray<RollupCheck>, status: string): number {
	return checks.filter((check) => check.status === status).length
}

function coderabbit_state_of(check: RollupCheck | undefined): CodeRabbitState {
	if (check === undefined) return 'none'
	if (check.status === CHECK_STATUS_PENDING) return 'running'
	if (check.status !== CHECK_STATUS_PASS) return 'failed'

	return is_coderabbit_rate_limited(check) ? 'rate-limited' : 'done'
}

// CodeRabbit's state on one poll — the reading `run:board` draws and `followup` times
// (`followup-coderabbit-wait.ts`).
function coderabbit_of(snapshot: PrStateSnapshot): CodeRabbitState {
	return coderabbit_state_of(snapshot.rollup.find((check) => is_coderabbit_check(check.name)))
}

function summary_of(snapshot: PrStateSnapshot, pr: number): PrChecks {
	const ci = snapshot.rollup.filter((check) => !is_coderabbit_check(check.name))

	return {
		pr,
		pass: count_of(ci, CHECK_STATUS_PASS),
		pending: count_of(ci, CHECK_STATUS_PENDING),
		fail: count_of(ci, CHECK_STATUS_FAIL),
		coderabbit: coderabbit_of(snapshot),
	}
}

function pr_number_of(pr_url = ''): number | undefined {
	const number = PR_NUMBER_PATTERN.exec(pr_url)?.groups?.['number']

	return number === undefined ? undefined : Number(number)
}

async function skip_snapshot(): Promise<void> {
	// Nothing names the child or its pull request, so there is no row to report to.
}

// An observer that writes a line only when it differs from the one this wait last wrote; one that
// does nothing where the issue or the pull request is unknown.
function observer_of(issue: string | undefined, pr_url: string | undefined): SnapshotObserver {
	const pr = pr_number_of(pr_url)

	if (issue === undefined || pr === undefined) return skip_snapshot

	let last_text = ''

	return async function report_snapshot(snapshot: PrStateSnapshot): Promise<void> {
		const text = run_event_checks.text_of(issue, summary_of(snapshot, pr))

		if (text === last_text) return

		last_text = text
		await run_event_stream_emit.emit(PR_CHECKS, text)
	}
}

const followup_checks_event = { coderabbit_of, observer_of, summary_of }

export { followup_checks_event }
