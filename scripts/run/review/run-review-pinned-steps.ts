import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import type { LaunchResult } from '#scripts/run/detached-launch'
import { test_pinned_record, type PinnedSummary } from '#scripts/test/test-pinned-record'
import { run_review_steps } from './run-review-steps'

// The background `josh test:pinned` of `josh run:review` (joshuafolkken/kit#4770): launched beside the
// gate and the brief, and waited on at `--join`. Run as its own `josh` command, it reserves its own
// cores (`DIRECT_UNIT_CLAIM`), so it shares the budget with the gate's units rather than overrunning it.
//
// **Two records, both keyed to the checkout.** The check writes its answer under the launch's token
// (`test-pinned-record.ts`); the start writes the launched pid and that token here. No pid means no check was
// launched — an `--unpinned-ok` run checked in place — and a pid that is gone without an answer is a
// check that died, which fails open the way a check that could not run does.

const PINNED_COMMAND = 'test:pinned'
const RECORD_FLAG = '--record'
const LAUNCH_PREFIX = 'josh-run-review-pinned-launch-'
const LOG_PREFIX = 'josh-run-review-pinned-log-'
const MS_PER_SECOND = 1000
const LOST_NOTE = 'its process ended without an answer'
const TIMED_OUT_NOTE = `no answer within ${String(run_review_steps.MAX_JOIN_WAIT_MS / MS_PER_SECOND)}s`

type Clock = () => number

interface Launch {
	pid: number
	token: string
}

function launch_path(root: string = PROJECT_ROOT): string {
	return stamp_file.stamp_path(LAUNCH_PREFIX, root)
}

function log_path(root: string = PROJECT_ROOT): string {
	return stamp_file.stamp_path(LOG_PREFIX, root, '.log')
}

// Every start clears the last pair's records first, so a join never reads an earlier tree's answer.
function clear(root: string = PROJECT_ROOT): void {
	test_pinned_record.clear(root)
	stamp_file.remove_stamp(launch_path(root))
}

// The token ties the answer to this launch (`test-pinned-record.ts`).
function launch(root: string = PROJECT_ROOT): LaunchResult {
	const token = randomUUID()
	const argv = [PINNED_COMMAND, RECORD_FLAG, token]
	const launched = run_review_steps.launch_josh(argv, log_path(root), root)

	if (launched.kind === 'launched') {
		stamp_file.write_stamp(launch_path(root), { pid: launched.pid, token })
	}

	return launched
}

function to_launch(value: unknown): Launch | undefined {
	const { pid, token } = value as Record<string, unknown>

	return typeof pid === 'number' && typeof token === 'string' ? { pid, token } : undefined
}

function read_launch(root: string): Launch | undefined {
	const raw = stamp_file.read_stamp_text(launch_path(root))

	if (raw === undefined) return undefined

	try {
		return to_launch(JSON.parse(raw))
	} catch {
		return undefined
	}
}

// One read: the answer, `undefined` while the check is still running, or a not-run answer once its
// process is gone without one. The record is read again after the pid is found gone, because the
// check writes its answer before it exits.
function read_answer(root: string, { pid, token }: Launch): PinnedSummary | undefined {
	const summary = test_pinned_record.read(token, root)

	if (summary !== undefined) return summary
	if (process_identity.is_same_process(pid, undefined) !== false) return undefined

	return (
		test_pinned_record.read(token, root) ?? test_pinned_record.not_run_summary(new Error(LOST_NOTE))
	)
}

// The check usually settles while the review is still running; the cap only bounds one that hung,
// which fails open rather than blocking for ever.
async function poll_answer(root: string, launched: Launch, now: Clock): Promise<PinnedSummary> {
	const started = now()
	let summary = read_answer(root, launched)

	while (summary === undefined && now() - started < run_review_steps.MAX_JOIN_WAIT_MS) {
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await sleep(run_review_steps.POLL_INTERVAL_MS)
		summary = read_answer(root, launched)
	}

	return summary ?? test_pinned_record.not_run_summary(new Error(TIMED_OUT_NOTE))
}

// `undefined` when no check was launched.
async function wait_for_answer(
	root: string = PROJECT_ROOT,
	now: Clock = () => Date.now(),
): Promise<PinnedSummary | undefined> {
	const launched = read_launch(root)

	if (launched === undefined) return undefined

	return await poll_answer(root, launched, now)
}

const run_review_pinned_steps = { clear, launch, log_path, wait_for_answer }

export { run_review_pinned_steps }
