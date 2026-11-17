import { issue_cite } from '#scripts/issue/issue-cite'
import type { IssueComment } from '#scripts/issue/issue-read'
import { session_language } from '#scripts/josh/session-language'
import { run_park_body } from '#scripts/run/park/run-park-body'
import { run_park_lane } from '#scripts/run/park/run-park-lane'
import { run_stalled } from '#scripts/run/park/run-stalled'
import { run_stalled_park } from '#scripts/run/park/run-stalled-park'

// The park loop `backlog:triage --adopt` stops (joshuafolkken/kit#7820): the child parked, an option
// was adopted and the child requeued, and it parked again on the lane tree (HEAD and uncommitted
// change count, `run-park-lane.ts`) it had parked on before — the adopted option was never taken, so
// a requeue would hit the same wall. The adopt parks it `run:stalled` for a person instead.
//
// It compares trees, not times: the yield cap (`backlog-yield-cap.ts`) counts a child's yields to a
// held lane within a window, and a park → adopt → relaunch is no yield, so it counts none of them.
// A park with no tree line (outside a lane, or written before the note carried it) is never a loop.

const ADOPT_MARK = 'adopted park option '
const ADOPT_COMMAND = '(backlog:triage --adopt)'
const NOT_HELD =
	'decision recorded and park cleared, but parking the unchanged re-park for a person failed; re-run this command'

interface ParkLoop {
	// The earlier adopt's decision line, which names the option adopted before.
	adopted: string
	tree: string
}

type Kind = (comment: IssueComment) => boolean

function is_park(comment: IssueComment): boolean {
	return comment.is_trusted === true && run_park_body.problem_of(comment.body) === undefined
}

function is_adopt(comment: IssueComment): boolean {
	const { body } = comment

	return comment.is_trusted === true && body.includes(ADOPT_MARK) && body.includes(ADOPT_COMMAND)
}

function last_before(comments: ReadonlyArray<IssueComment>, end: number, is_kind: Kind): number {
	return comments.slice(0, Math.max(end, 0)).findLastIndex((comment) => is_kind(comment))
}

function tree_at(comments: ReadonlyArray<IssueComment>, index: number): string | undefined {
	const comment = comments[index]

	return comment === undefined ? undefined : run_park_lane.tree_of(comment.body)
}

function first_line(comment: IssueComment | undefined): string {
	return comment?.body.split('\n', 1)[0]?.trim() ?? ''
}

// The loop the latest park closes — the adopt before it and the park before that, on the same tree —
// or `undefined`.
function loop_of(comments: ReadonlyArray<IssueComment>): ParkLoop | undefined {
	const park = last_before(comments, comments.length, is_park)
	const adopt = last_before(comments, park, is_adopt)
	const earlier = last_before(comments, adopt, is_park)
	const tree = tree_at(comments, park)

	if (tree === undefined || tree !== tree_at(comments, earlier)) return undefined

	return { adopted: first_line(comments[adopt]), tree }
}

function comment_of(issue: string, option: number, loop: ParkLoop): string {
	const child = issue_cite.plain_for('github', issue)
	const k = String(option)
	const retry = `\`${run_stalled.resume_of(issue, true)}\``

	if (session_language.is_japanese(session_language.resolve_session_lang().lang)) {
		return `${child}: 選択肢 ${k} を採用しましたが、再キューしていません（${run_stalled.PARK_LOOP.short}）。前の採用（${loop.adopted}）の後、子はレーンのツリー（${loop.tree}）が変わらないまま再び park しました。採用した選択肢は実行されていません。\n\n次: 選択肢を人が実行してから、${retry} で再開してください。`
	}

	return `${child}: option ${k} adopted but not requeued (${run_stalled.PARK_LOOP.short}): after the earlier adopt (${loop.adopted}) ${run_stalled.PARK_LOOP.why} Lane tree: ${loop.tree}.\n\nNext: take the option by hand, then resume with ${retry}.`
}

// Parks the child `run:stalled` with the loop's reason instead of requeuing it.
async function hold(
	issue: string,
	option: number,
	loop: ParkLoop,
): Promise<{ next: string } | { problem: string }> {
	const is_parked = await run_stalled_park.apply(
		issue,
		comment_of(issue, option, loop),
		run_stalled.PARK_LOOP.short,
	)

	return is_parked
		? { next: `not requeued: lane tree ${loop.tree} unchanged since the last adopted option` }
		: { problem: NOT_HELD }
}

const backlog_triage_park_loop = { hold, loop_of }

export { backlog_triage_park_loop }
export type { ParkLoop }
