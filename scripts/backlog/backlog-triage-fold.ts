import { session_cite } from '#scripts/issue/session-cite'
import { lane_fold } from '#scripts/lane/lane-fold'
import { run_park_body } from '#scripts/run/park/run-park-body'

// A folding option of a park (joshuafolkken/kit#7985): ship this Issue in another Issue's pull request,
// which a child cannot do itself. `backlog:triage --adopt` reads its `--into #M` before the first write,
// refusing a fold option naming none, and after the decision runs `lane:fold` instead of a requeue — a
// requeued child would park on the same wall again.

const NO_INTO =
	'names lane:fold with no "--into #<M>"; the park must name the Issue to ship in — nothing was written and the child stays parked'

type FoldResult = { next: string } | { problem: string }

interface FoldRequest {
	issue: string
	into: string
	reason: string
}

// Why option `option` cannot be adopted as a fold: one naming `lane:fold` with no `--into #M`.
function problem_of(body: string, option: number): string | undefined {
	const is_unnamed =
		run_park_body.fold_action(body, option) && run_park_body.fold_target(body, option) === undefined

	return is_unnamed ? `option ${String(option)} ${NO_INTO}` : undefined
}

// The fold, then what the run did next, or the problem naming the command that finishes it.
async function fold(request: FoldRequest): Promise<FoldResult> {
	const { issue, into } = request
	const outcome = await lane_fold.fold(request)
	const target = session_cite.issue(into)

	if (outcome.kind === 'folded') return { next: `folded into ${target} · not requeued` }

	return {
		problem: `decision recorded and park cleared, but folding into ${target} failed at ${outcome.step}: ${outcome.message}; run: pnpm josh lane:fold ${issue} --into ${into} --reason "<reason>"`,
	}
}

const backlog_triage_fold = { fold, problem_of, target_of: run_park_body.fold_target }

export { backlog_triage_fold }
