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

const SUCCESS_EXIT_CODE = 0
const WRITTEN_HEAD = 'decision recorded and park cleared, but'

type CloseResult = { next: string } | { problem: string }

function comment_of(reason: string): string {
	return `Closed as not planned by an adopted park option (\`backlog:triage --adopt\`): ${reason}`
}

async function close(issue: string, reason: string): Promise<CloseResult> {
	const is_closed = await git_gh_command.issue_close(issue, comment_of(reason), 'not_planned')

	if (!is_closed) {
		return {
			problem: `${WRITTEN_HEAD} closing ${session_cite.issue(issue)} failed; re-run this command`,
		}
	}

	await epic_close.close_completed_epics({ issue_number: issue, is_merged: true })
	const released = await run_park_release.release(issue)

	if (released === SUCCESS_EXIT_CODE) {
		return { next: 'closed as not planned · lane returned, not requeued' }
	}

	return {
		problem: `closed as not planned, but the release failed; run: pnpm josh run:release ${issue}`,
	}
}

const backlog_triage_close = { close }

export { backlog_triage_close }
