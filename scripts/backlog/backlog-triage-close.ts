import { epic_close } from '#scripts/epic/epic-close'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { session_cite } from '#scripts/issue/session-cite'
import { run_park_release } from '#scripts/run/park/run-park-release'

// The close an adopted closing option takes (joshuafolkken/kit#7805): the parked child closed as not
// planned with the adopt's reason as its comment, the epics it completes closed, and its lane returned
// the way `josh issue:premise-unmet` ends — no requeue, so no restarted lane meets the same plan with
// no way to close it. The release is `run_park_release`'s: the adopt runs from the parent's checkout,
// whose hold is another run's, and a bare `run:hold --release` there answers `held`. The decision and
// the park clear come before it
// (`backlog-triage-adopt.ts`), so a failed close names what was written and a re-run closes it.
//
// **A no-diff investigation lane closes through the same path as completed** (joshuafolkken/kit#7821):
// `run:cut <N> --deliverable <url>` from the lane child's own checkout, whose hold is its own, so the
// release returns it; the parent's `run:merge` collects the closed child the way it collects a merged
// one. Only the state reason and the comment differ.

const SUCCESS_EXIT_CODE = 0
const WRITTEN_HEAD = 'decision recorded and park cleared, but'

type CloseResult = { next: string } | { problem: string }
type CloseReason = 'not_planned' | 'completed'

interface Closing {
	reason: CloseReason
	comment: string
	// What was already written when the close fails, so a re-run is named against it.
	written: string
}

const LABEL: Readonly<Record<CloseReason, string>> = {
	not_planned: 'closed as not planned',
	completed: 'closed as completed',
}

async function close_with(issue: string, closing: Closing): Promise<CloseResult> {
	const is_closed = await git_gh_command.issue_close(issue, closing.comment, closing.reason)

	if (!is_closed) {
		return {
			problem: `${closing.written} closing ${session_cite.issue(issue)} failed; re-run this command`,
		}
	}

	await epic_close.close_completed_epics({ issue_number: issue, is_merged: true })
	const released = await run_park_release.release(issue)
	const label = LABEL[closing.reason]

	if (released === SUCCESS_EXIT_CODE) return { next: `${label} · lane returned, not requeued` }

	return { problem: `${label}, but the release failed; run: pnpm josh run:release ${issue}` }
}

async function close(issue: string, reason: string): Promise<CloseResult> {
	return await close_with(issue, {
		reason: 'not_planned',
		comment: `Closed as not planned by an adopted park option (\`backlog:triage --adopt\`): ${reason}`,
		written: WRITTEN_HEAD,
	})
}

async function close_completed(issue: string, deliverable: string): Promise<CloseResult> {
	return await close_with(issue, {
		reason: 'completed',
		comment: `Closed as completed: the investigation is done and its deliverable is ${deliverable} (\`run:cut --deliverable\`).`,
		written: 'nothing was written, but',
	})
}

const backlog_triage_close = { close, close_completed }

export type { CloseResult }
export { backlog_triage_close }
