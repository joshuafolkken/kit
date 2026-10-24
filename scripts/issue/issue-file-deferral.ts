import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { shell_quote } from '#scripts/lib/shell-quote'
import { session_cite } from './session-cite'

// What `josh issue:file --found-during <N>` leaves on #N: one comment, `NOTE_PREFIX <filed> <title>`, so
// the deferral is read wherever #N is read. The run event alone reached neither `issue:read <N>` nor the
// ship reviewer's brief, so the reviewer raised the deferred gap again as a Medium and the ship
// stopped on scope the lane had already filed away (joshuafolkken/kit#4821). `review-rubric.md` →
// "Stop conditions" is the rule that reads the note.
//
// Only a finder the filing names is noted — a finder inferred from the lane mark or the branch is the
// run's, not a declared deferral. The finder is an Issue in this repository, so the comment is posted
// to `current` even when `GH_REPO` points the filing's listings at another target. The Issue already
// exists, so a failed comment is reported rather than failed, for the reason `issue-file-cli.ts` →
// `place` gives.

const NOTE_PREFIX = '先送り:'

interface Deferral {
	found_during: string | undefined
	reference: string
	title: string
	current: string
}

function note_of(deferral: Deferral): string {
	return `${NOTE_PREFIX} ${deferral.reference} ${deferral.title}`
}

function failure_line(finder: number, note: string): string {
	const rerun = `pnpm josh issue:comment ${String(finder)} --body ${shell_quote.single_quoted(note)}`

	return `⚠ the deferral note did not reach ${session_cite.issue(finder)} — run \`${rerun}\`.`
}

async function note_finder(deferral: Deferral): Promise<void> {
	const finder = Number(deferral.found_during)

	if (!Number.isSafeInteger(finder) || finder <= 0) return
	const note = note_of(deferral)
	const is_noted = await git_gh_issue_write.issue_try_comment(
		String(finder),
		note,
		deferral.current,
	)

	if (!is_noted) console.error(failure_line(finder, note))
}

const issue_file_deferral = { NOTE_PREFIX, note_finder }

export { issue_file_deferral }
