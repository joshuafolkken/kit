import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#3424: an Issue number reaches a string only through `issue_cite` — `session_cite`
// for what a session reads, `issue_cite.plain` for what GitHub renders or a program reads. A bare
// `#${…}` assembled anywhere else is how an unlinked `#N` slipped into josh's session output, and the
// Stop guard then sent the reply that copied it back for a second turn.
//
// **`issue_cite.plain` is counted, not trusted.** Refusing the template alone left `plain` free to
// print a bare `#N` straight to the session, so every call is recorded below against the reason its
// text stays plain. A new call — in a listed file or a new one — fails here; a new caller uses
// `issue_cite.plain_for`, whose required reason declares at the call why it is not session-facing,
// so it edits no list here (joshuafolkken/kit#6807). The list only shrinks: joshuafolkken/kit#6810
// moves the calls below to `plain_for` and deletes it.

const SCRIPTS_ROOT = fileURLToPath(new URL('..', import.meta.url))
const BARE_TEMPLATE = '#${'
const PLAIN_CALL = 'issue_cite.plain('
// The files allowed a `#${…}`: the single place the bare Issue form is assembled, and the files whose
// `#` marks something that is not an Issue number at all.
const EXEMPT = new Set([
	path.join('issue', 'issue-cite.ts'),
	// A message index standing in for a missing message id.
	path.join('delegation', 'investigation-reads.ts'),
	path.join('rules', 'rule-value.ts'),
	path.join('time-runtime', 'time-round-trips.ts'),
	// A rank in a table.
	path.join('package', 'package-scout-format.ts'),
	// A URL fragment.
	path.join('safe-chain', 'preinstall-command.ts'),
])

// Every `issue_cite.plain` call, by file, with why its text is not printed to the session as it is.
const PLAIN_CALLS: ReadonlyArray<readonly [string, number]> = [
	// GitHub renders it: a commit message, a PR or Issue title or body, a comment, a search query.
	['backlog/backlog-triage-adopt.ts', 1],
	['epic/epic-audit-orphans.ts', 1],
	['epic/epic-bundle-apply.ts', 1],
	['epic/epic-bundle-recommend.ts', 4],
	['epic/epic-close-comment.ts', 2],
	['followup/git-followup-flush.ts', 1],
	['gh/git-pr.ts', 2],
	['git/git-issue.ts', 3],
	['git/main-merge.ts', 1],
	['hooks/check-commit-message.ts', 3],
	['init/start-setup-pr.ts', 1],
	['issue/issue-file-interrupt.ts', 1],
	['observations/observations-flush-landing.ts', 1],
	['propagate/propagate-steps.ts', 1],
	['review/disposition-batch-filing.ts', 1],
	['review/review-finding-ledger.ts', 1],
	['run/merge/run-merge-steps.ts', 1],
	// The causing-lane line a refused filing prints to be pasted into the Issue body, whose shape
	// `issue-priority.ts` reads with the bare `#N`.
	['issue/issue-file-lane-hint.ts', 1],
	// The stash name `stash:pop` matches, and the finder backlink comment and its Telegram copy; the
	// stash line it prints goes through `session_cite.text`.
	['issue/upstream-interrupt-cli.ts', 3],
	// The follow-up's title, background line and moved-criteria link, and the split epic's title and
	// rationale — all rendered by GitHub.
	['issue/issue-spill.ts', 3],
	['issue/issue-spill-cli.ts', 2],
	// The stash name `stash:pop` matches; the stop report prints it inside a command to copy verbatim.
	['run/entry/run-entry-sync.ts', 1],
	// A person reads it on Telegram.
	['notify/git-notify.ts', 1],
	['backlog/backlog-drive-idle.ts', 1],
	['backlog/backlog-drive-paused.ts', 1],
	['run/merge/run-merge-auth.ts', 1],
	// The untrusted-author stop's remedy: the Telegram `recommended`, and a report line the session
	// reads through `session_cite.text`.
	['run/entry/run-entry-trust.ts', 1],
	// A program reads it back: the run event stream, a process pattern, a child prompt, a parse key.
	['backlog/backlog-drive-adopt.ts', 1],
	['backlog/backlog-drive-cli.ts', 1],
	['backlog/backlog-drive-epic.ts', 1],
	['backlog/backlog-drive-named-offer.ts', 1],
	['backlog/backlog-drive-retry.ts', 2],
	['backlog/backlog-measure-close.ts', 2],
	['backlog/backlog-wait-cause.ts', 1],
	// The run event stream's trip note, and the park comment GitHub renders.
	['backlog/backlog-yield-cap.ts', 1],
	['lane/lane-overrun.ts', 1],
	['lane/lane-overrun-prompt.ts', 1],
	['lane/lane-plan-wait-event.ts', 2],
	['lane/lane-session-broker.ts', 1],
	['lane/lane-withdraw.ts', 1],
	// The folded split child's ledger `child`, which `split-resolution.ts` reads back.
	['split/split-resolution.ts', 1],
	// Yield and withdrawal event payloads; their renderer resolves session citations.
	['lane/lane-yield.ts', 2],
	['run/merge/run-merge-usage-limit.ts', 1],
	// The detached driver's stderr, which the supervisor tails into the hand-off; the read that would
	// resolve the link is the one that just failed.
	['backlog/backlog-drive-unread.ts', 1],
	['backlog/backlog-drive-state.ts', 1],
	['backlog/backlog-plan.ts', 1],
	['epic/epic-parse.ts', 1],
	['issue/issue-file-cli.ts', 1],
	['lane/lane-adopt-cli.ts', 1],
	['lane/lane-breakdown-estimate.ts', 1],
	['lane/lane-child-invocation.ts', 7],
	['lane/lane-dispatch.ts', 2],
	['lane/lane-pause-cli.ts', 2],
	['lane/lane-phase.ts', 1],
	['lane/lane-restart.ts', 1],
	['run/board/run-board-notes.ts', 1],
	// The run board's frame, which a person watches in a terminal or on Telegram; `run:board --chat`
	// answers with it inside one code block, where nothing is linked.
	['run/board/run-board-now.ts', 1],
	['run/board/run-board-process-groups.ts', 1],
	['run/board/run-board-render-notes.ts', 1],
	['run/board/run-board-standing-waits.ts', 1],
	['run/cut/run-cut-cli.ts', 1],
	['run/cut/run-cut-report.ts', 1],
	['run/cut/run-cut-resume.ts', 1],
	['run/entry/run-entry-stop.ts', 4],
	['run/event/run-event-checks.ts', 1],
	['run/event/run-event-filed.ts', 1],
	['run/event/run-event-overrun.ts', 7],
	['run/event/run-event-plan.ts', 1],
	['run/event/run-event-scope.ts', 1],
	['run/event/run-event-setup.ts', 4],
	// The halfrun / prrun stop confirmation: copy-out commands.
	['run/hold/run-stop-notify.ts', 1],
	['run/merge/run-merge-cli.ts', 6],
	['run/merge/run-merge-decision.ts', 1],
	['run/merge/run-merge-human-review.ts', 1],
	// The `run:stalled` park event, the resume command a park comment and a board row name, and the
	// blocker a stalled board row waits on.
	['run/park/run-stalled.ts', 3],
	// The `run:pause` stash name, its idempotence marker, and the pause comment on the paused Issue.
	['run/pause/run-pause.ts', 2],
	['run/pause/run-pause-comment.ts', 1],
	// The `run:split` stash name, its idempotence marker, the split comment and the park comment.
	['run/split/run-split.ts', 3],
	// The `run:split --prerequisite` park comment on the paused Issue.
	['run/split/run-split-prerequisite.ts', 2],
	['run/ship/run-ship-detach.ts', 1],
	// The handover note on the run event stream, which `run:board` attributes by its `#<N>`.
	['run/ship/run-ship-handover.ts', 1],
	// The ship-stop cap's Telegram warning.
	['run/ship/run-ship-relaunch-cap.ts', 1],
	// The `relaunch-failed` event `run:merge` reads.
	['run/ship/run-ship-return.ts', 1],
	// The reviewer child's prompt, which an agent reads.
	['run/ship/run-ship-review.ts', 1],
	['run/ship/run-ship-stage.ts', 1],
	['run/ship/run-ship-stop-text.ts', 1],
	// Printed through `session_cite.text` or `issue_citation.linkify` by the caller that prints it.
	['epic/epic-audit-checks.ts', 1],
	['epic/epic-bundle-format.ts', 2],
	['lane/lane-sinks-issues.ts', 1],
	['epic/epic-bundle-evidence.ts', 2],
	['epic/epic-bundle.ts', 3],
	['epic/epic-next-views.ts', 1],
	['epic/epic-reference.ts', 1],
	['epic/epic-solo-stale.ts', 1],
	['issue/issue-sample-gate.ts', 1],
	['epic/epic-solo.ts', 2],
	['epic/epic-triage.ts', 1],
	['issue/defect-origin.ts', 2],
	['issue/defect-report-format.ts', 1],
	// The audit row `effect-audit-cli.ts` prints through `session_cite.text`, the token a follow-up's
	// body is matched on, and the retirement-candidate draft written to a file.
	['issue/effect-audit.ts', 1],
	// The hand-off report body, which `run-report-cli.ts` links before printing and sending.
	['run/run-report-handoff.ts', 1],
	['run/run-stage.ts', 2],
]

function is_source(file: string): boolean {
	return file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('-fixture.ts')
}

function read_source(file: string): string {
	return readFileSync(path.join(SCRIPTS_ROOT, file), 'utf8')
}

function bare_sites(file: string): Array<string> {
	const lines = read_source(file).split('\n')

	return lines
		.map((line, index) => ({ line, site: `${file}:${String(index + 1)}` }))
		.filter(({ line }) => line.includes(BARE_TEMPLATE))
		.map(({ site }) => site)
}

function sources(): Array<string> {
	const files = readdirSync(SCRIPTS_ROOT, { recursive: true, encoding: 'utf8' })

	return files.filter((file) => is_source(file))
}

function scanned_sources(): Array<string> {
	return sources().filter((file) => !EXEMPT.has(file))
}

function by_file(left: readonly [string, number], right: readonly [string, number]): number {
	return left[0].localeCompare(right[0])
}

// The reasonless calls in one source; a `plain_for(` call does not contain `plain(`.
function plain_count(source: string): number {
	return source.split(PLAIN_CALL).length - 1
}

// `posix` paths so the table reads the same on every platform the scan runs on.
function plain_calls(): Array<readonly [string, number]> {
	const counted = sources().map(
		(file) => [file.split(path.sep).join(path.posix.sep), plain_count(read_source(file))] as const,
	)

	return counted.filter(([, count]) => count > 0).toSorted(by_file)
}

describe('Issue numbers in scripts/ go through issue_cite', () => {
	it('assembles no bare `#${…}` outside issue-cite.ts', () => {
		expect(scanned_sources().flatMap((file) => bare_sites(file))).toStrictEqual([])
	})

	it('scans the sources it guards', () => {
		expect(scanned_sources()).toContain(path.join('lane', 'lane-occupancy.ts'))
	})

	it('calls issue_cite.plain only where the text is not printed to the session as it is', () => {
		expect(plain_calls()).toStrictEqual(PLAIN_CALLS.toSorted(by_file))
	})

	// joshuafolkken/kit#6807: a new file's reasoned call needs no row above; a reasonless one still does.
	it('counts a reasonless issue_cite.plain call and not a plain_for call', () => {
		const reasoned = "const line = issue_cite.plain_for('github', issue)\n"
		const reasonless = 'const line = issue_cite.plain(issue)\n'

		expect(plain_count(reasoned)).toBe(0)
		expect(plain_count(`${reasoned}${reasonless}`)).toBe(1)
	})
})
