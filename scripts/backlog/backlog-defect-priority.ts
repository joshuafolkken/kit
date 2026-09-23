import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult, RepoCandidates } from '#scripts/epic/epic-report'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { defect_rate, type DefectRate, type IssueKind } from '#scripts/issue/defect-rate'
import { defect_rate_cli } from '#scripts/issue/defect-rate-cli'

// While the defect rate is above its baseline, `backlog:next` offers defects and hardening first and
// defers new mechanisms (joshuafolkken/kit#2455). The re-ordering stays inside the runnable set — every
// candidate is already ready to start — so no dependency the graph recorded is crossed.

const UNMEASURED_MESSAGE =
	'The defect rate could not be read from GitHub, so the backlog is offered in its usual order.'

// Lower goes first. The sort is stable, so each kind keeps the order the graph gave it.
const KIND_RANK: Readonly<Record<IssueKind, number>> = { defect: 0, other: 1, mechanism: 2 }

function above_message(measured: DefectRate): string {
	return `The defect rate ${defect_rate.rate_text(measured)} is above its baseline ${String(defect_rate.BASELINE_RATE)}, so defects are offered first and new mechanisms last.`
}

// An unreadable body reads as empty: the labels still classify `route:interrupt`, and anything else
// keeps its usual place rather than being deferred on a read that failed.
async function kind_of_child(child: EpicChild): Promise<IssueKind> {
	const body = await git_gh_command.issue_get_body(String(child.number), child.repo)

	return defect_rate.kind_of({ body: body ?? '', labels: child.labels })
}

async function reorder_bundle(bundle: RepoCandidates): Promise<RepoCandidates> {
	const kinds = await Promise.all(bundle.children.map(async (child) => await kind_of_child(child)))
	const ranked = bundle.children.map((child, index) => ({
		child,
		rank: KIND_RANK[kinds[index] ?? 'other'],
	}))
	const children = ranked.toSorted((left, right) => left.rank - right.rank).map((row) => row.child)

	return { ...bundle, children }
}

async function reorder(result: EpicNextResult, repo: string): Promise<EpicNextResult> {
	const candidates = await Promise.all(
		result.candidates.map(async (bundle) =>
			bundle.repo === repo ? await reorder_bundle(bundle) : bundle,
		),
	)

	return { ...result, candidates }
}

// The result as `backlog:next` should offer it. Only a `run` answer has anything to order, and only
// this repository's bundle is re-ordered, because only its numbers reach standard output.
async function prioritize(
	result: EpicNextResult,
	repo: string,
	now_ms: number = Date.now(),
): Promise<EpicNextResult> {
	if (result.verdict !== 'run') return result

	const days = defect_rate.DEFAULT_WINDOW_DAYS
	const measured = await defect_rate_cli.measure_window(repo, days, now_ms)

	if (measured === undefined) {
		console.error(UNMEASURED_MESSAGE)

		return result
	}

	if (!defect_rate.is_above_baseline(measured)) return result

	console.error(above_message(measured))

	return await reorder(result, repo)
}

const backlog_defect_priority = { UNMEASURED_MESSAGE, KIND_RANK, prioritize }

export { backlog_defect_priority }
