import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult, RepoCandidates } from '#scripts/epic/epic-report'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { defect_rate, type DefectRate, type IssueKind } from '#scripts/issue/defect-rate'
import { defect_rate_cli } from '#scripts/issue/defect-rate-cli'

// `backlog:next` defers new mechanisms while the defect rate is above its baseline. Offering a defect
// first is not done here: it is a ranking key of `issue-rank.ts` (joshuafolkken/kit#7912). The
// re-ordering stays inside the runnable set — every candidate is already ready to start — so no
// dependency the graph recorded is crossed.

// Where a backlog notice goes: `console.error` for `backlog:next` / `backlog:plan`, nowhere for `run:board`.
type Report = (line: string) => void

const UNMEASURED_MESSAGE =
	'The defect rate could not be read from GitHub, so new mechanisms are not deferred.'

// Lower goes first. The sort is stable, so defects and other issues keep the order the ranking gave
// them; only a new mechanism moves, behind both.
const DEFERRED_KIND_RANK: Readonly<Record<IssueKind, number>> = {
	defect: 0,
	other: 0,
	mechanism: 1,
}

function above_message(measured: DefectRate): string {
	return `The defect rate ${defect_rate.rate_text(measured)} is above its baseline ${String(defect_rate.BASELINE_RATE)}, so among issues the ranking keys tie, new mechanisms are offered last.`
}

function should_defer_mechanisms(measured: DefectRate | undefined, report: Report): boolean {
	if (measured === undefined || measured.is_capped) {
		report(UNMEASURED_MESSAGE)

		return false
	}

	if (!defect_rate.is_above_baseline(measured)) return false

	report(above_message(measured))

	return true
}

// The body the listing already carried, else one read for it (joshuafolkken/kit#4550). An unreadable
// body reads as empty: the labels still classify `route:interrupt`, and anything else keeps its usual
// place rather than being deferred on a read that failed.
async function kind_of_child(child: EpicChild): Promise<IssueKind> {
	const body = child.body ?? (await git_gh_command.issue_get_body(String(child.number), child.repo))

	return defect_rate.kind_of({ body: body ?? '', labels: child.labels })
}

async function defer_bundle(bundle: RepoCandidates): Promise<RepoCandidates> {
	const kinds = await Promise.all(bundle.children.map(async (child) => await kind_of_child(child)))
	const ranked = bundle.children.map((child, index) => ({
		child,
		rank: DEFERRED_KIND_RANK[kinds[index] ?? 'other'],
	}))
	const children = ranked.toSorted((left, right) => left.rank - right.rank).map((row) => row.child)

	return { ...bundle, children }
}

async function defer_mechanisms(result: EpicNextResult, repo: string): Promise<EpicNextResult> {
	const candidates = await Promise.all(
		result.candidates.map(async (bundle) =>
			bundle.repo === repo ? await defer_bundle(bundle) : bundle,
		),
	)

	return { ...result, candidates }
}

// The result as `backlog:next` should offer it. Only a `run` answer has anything to order, only while
// the rate is above its baseline is anything moved, and only this repository's bundle is re-ordered,
// because only its numbers reach standard output. Its notices go to `report`, so a caller drawing its own
// screen — `run:board` — keeps them off it (joshuafolkken/kit#9007).
async function prioritize(
	result: EpicNextResult,
	repo: string,
	report: Report,
	now_ms: number = Date.now(),
): Promise<EpicNextResult> {
	if (result.verdict !== 'run') return result

	const days = defect_rate.DEFAULT_WINDOW_DAYS
	const measured = await defect_rate_cli.measure_window(repo, days, now_ms)

	if (!should_defer_mechanisms(measured, report)) return result

	return await defer_mechanisms(result, repo)
}

const backlog_defect_priority = { UNMEASURED_MESSAGE, prioritize }

export { backlog_defect_priority }
export type { Report }
