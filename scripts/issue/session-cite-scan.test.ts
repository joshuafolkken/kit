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
// text stays plain. A new call — in a listed file or a new one — fails here until it is either printed
// through `session_cite` or added with the reason it is not session-facing.

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
	['epic/epic-audit-orphans.ts', 1],
	['epic/epic-body.ts', 1],
	['epic/epic-close-comment.ts', 2],
	['followup/git-followup-flush.ts', 1],
	['gh/git-pr.ts', 2],
	['git/git-issue.ts', 3],
	['git/main-merge.ts', 1],
	['hooks/check-commit-message.ts', 3],
	['init/start-setup-pr.ts', 1],
	['observations/observations-flush-landing.ts', 1],
	['propagate/propagate-steps.ts', 1],
	['review/review-finding-ledger.ts', 1],
	['run/merge/run-merge-steps.ts', 1],
	// A person reads it on Telegram.
	['notify/git-notify.ts', 1],
	// A program reads it back: the run event stream, a process pattern, a child prompt, a parse key.
	['backlog/backlog-drive-cli.ts', 1],
	['backlog/backlog-drive-epic.ts', 1],
	['backlog/backlog-drive-named-offer.ts', 1],
	['backlog/backlog-drive.ts', 1],
	['backlog/backlog-plan.ts', 1],
	['epic/epic-parse.ts', 1],
	['issue/issue-file-cli.ts', 1],
	['lane/lane-child-invocation.ts', 5],
	['lane/lane-dispatch.ts', 2],
	['lane/lane-phase.ts', 1],
	['run/board/run-board-layout.ts', 1],
	['run/cut/run-cut-cli.ts', 3],
	['run/entry/run-entry-stop.ts', 3],
	['run/event/run-event-filed.ts', 1],
	['run/event/run-event-plan.ts', 1],
	['run/event/run-event-scope.ts', 1],
	['run/merge/run-merge-cli.ts', 7],
	['run/merge/run-merge.ts', 1],
	['run/ship/run-ship-detach.ts', 1],
	['run/ship/run-ship-stage.ts', 1],
	['run/ship/run-ship-stop-text.ts', 1],
	// Printed through `session_cite.text` or `issue_citation.linkify` by the caller that prints it.
	['epic/epic-audit-checks.ts', 1],
	['epic/epic-bundle-cli.ts', 1],
	['epic/epic-bundle-evidence.ts', 2],
	['epic/epic-bundle.ts', 3],
	['epic/epic-next-views.ts', 1],
	['epic/epic-reference.ts', 1],
	['epic/epic-solo-stale.ts', 1],
	['epic/epic-solo.ts', 2],
	['epic/epic-triage.ts', 1],
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

// `posix` paths so the table reads the same on every platform the scan runs on.
function plain_calls(): Array<readonly [string, number]> {
	const counted = sources().map(
		(file) =>
			[
				file.split(path.sep).join(path.posix.sep),
				read_source(file).split(PLAIN_CALL).length - 1,
			] as const,
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
})
