import { z } from 'zod'
import { git_gh_command } from './git-gh-command'
import { IN_PROGRESS_LABEL, label_name_of } from './issue-labels'
import { parse_json_object_safe } from './parse-json-array'
import { issue_label_schema } from './schemas'

// **`in-progress` means "a run is holding this issue right now", and a merged run is not holding
// anything** (joshuafolkken/kit#1794). `pnpm josh followup` merged the pull request and closed the
// issue and left the label on it, so the mark stopped meaning what it says: the ledger entry
// `k:followup-leaves-in-progress-label` recorded it on 2026-09-11 and a second sighting the same day
// — both issues of one `queue` answering `labels: in-progress` after they had closed.
//
// **Nothing is broken today, and that is the whole of the argument for fixing it.** `epic:next`,
// `epic:busy`, `run:progress` and the `auto-ok` pickup each filter to open issues, so a closed issue
// carrying the label is invisible to all of them — until one of them loses that open filter, at
// which point the label is already on every issue the repository has ever run.
//
// `queue.md` does tell whoever finds one to take it off, but that is the **failed child**'s route.
// No procedure covered the ordinary ending: merged, closed, and still marked as running.

// The `number,labels,body` read answers labels as objects, and this is the one field of it this
// step needs. The element shape is `schemas.ts`'s rather than a second spelling of it; the wrapper
// is local because a read's *field list* is what multiplies helpers when it is shared
// (`git-gh-issue-read.ts`).
const labels_read_schema = z.object({ labels: z.array(issue_label_schema).optional() })

// **Read, then removed — never removed on a guess.** The removal names the label in the request
// path, so it has to name the spelling GitHub stored: GitHub keeps the casing a label was created
// with and treats `In-Progress` as the same label, and a repository spelling it that way is exactly
// the one joshuafolkken/kit#1132 was filed about. The comparison is `label_name_of`'s, the same one
// every other membership test in this codebase goes through.
function unreadable_error(issue_number: string): Error {
	return new Error(`gh api answered no readable labels for issue #${issue_number}`)
}

async function read_label_names(issue_number: string): Promise<ReadonlyArray<string>> {
	const raw = await git_gh_command.issue_get_labels_and_body(issue_number)
	if (raw === undefined) throw unreadable_error(issue_number)

	const parsed = parse_json_object_safe(raw, labels_read_schema)
	if (parsed === undefined) throw unreadable_error(issue_number)

	return (parsed.labels ?? []).map((label) => label.name)
}

// **An issue that does not carry it is never written to**, which is what keeps the step silent on a
// run whose issue was never labelled — a `404` swallowed into a warning would report a failure where
// there was nothing to do. The read itself is always paid: one `number,labels,body` call per merged
// run, which is the read `git-epic-read.ts` already makes rather than a field list of its own.
//
// A run whose pull request named no issue has nothing to strip, so it returns rather than throwing:
// the number is recovered from the `closes #N` keyword, and its absence is already reported where
// the completion report is.
async function strip_in_progress(issue_number: string | undefined): Promise<void> {
	if (issue_number === undefined) return

	const stored = label_name_of(await read_label_names(issue_number), IN_PROGRESS_LABEL)
	if (stored === undefined) return

	await git_gh_command.issue_remove_label(issue_number, stored)
}

const git_followup_label = {
	strip_in_progress,
}

export { git_followup_label }
