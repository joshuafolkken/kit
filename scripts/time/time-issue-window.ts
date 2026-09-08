import { json_value } from '#scripts/json-value'
import { z } from 'zod'
import { time_github, type GhReader } from './time-github'
import { time_instant } from './time-instant'
import { time_windows, type TimeWindow } from './time-windows'

// The outermost of the three windows: from the moment the issue was filed to the moment it closed
// (joshuafolkken/kit#1409). It is the only one of the three neither source already answered — the
// transcript starts when someone opened a session, and the pull-request listing says nothing about
// the issue.
//
// **This is `time-github.ts`'s layer, in a second file**, for the reason `time-pull-files.ts` gives:
// that module sits at its 300-line limit, and splitting it along one of its five reads would move
// code this Issue does not touch. So the read goes through that module's own `GhReader` and its
// `ISSUES_PATH`, and nothing here reaches for `git_gh_exec` — the same REST layer, the same request
// budget, the same error translation.
//
// **It does not widen `read_issue_body`.** That one answers "the epic's task list" and returns the
// body alone; a second field on it would make every caller of a body read carry two stamps it has no
// use for, and its `undefined` already means something else there ("the read failed" as against "an
// empty body").

const ISSUE_WINDOW_SCHEMA = z.object({
	created_at: z.string().nullish(),
	closed_at: z.string().nullish(),
})

// **An open issue is unread, not zero-length.** `closed_at` is `null` while the issue is open, which
// is exactly `PullSummary.merged_ms`'s `undefined` for a pull request that has not merged — and the
// report prints `not measured` for it rather than a window it never saw close.
function to_window(text: string): TimeWindow {
	const parsed = ISSUE_WINDOW_SCHEMA.safeParse(json_value.parse_or_undefined(text))

	if (!parsed.success) return time_windows.UNREAD_WINDOW

	const created_ms = time_instant.parse_instant(parsed.data.created_at)
	const closed_ms = time_instant.parse_instant(parsed.data.closed_at)

	return time_windows.build_window(created_ms ?? 0, closed_ms)
}

// A refused read answers the same way an absent one does, deliberately: the window is the only thing
// this module produces, and `is_read: false` is already the shape that says "nobody established
// this". A caller that needed to tell a rate limit from an open issue would be asking a different
// question, and none does.
async function read_issue_window(
	issue_number: number,
	read: GhReader = time_github.read_gh,
): Promise<TimeWindow> {
	try {
		return to_window(await read(`${time_github.ISSUES_PATH}/${String(issue_number)}`))
	} catch {
		return time_windows.UNREAD_WINDOW
	}
}

const time_issue_window = { read_issue_window, to_window }

export { time_issue_window }
