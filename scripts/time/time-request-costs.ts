import { cost_cli } from '#scripts/cost/cost-cli'
import { cost_pricing } from '#scripts/cost/cost-pricing'
import type { UsageRecord } from '#scripts/cost/cost-usage'
import type { PricedRequest } from './time-phase-costs'
import type { RunSources } from './time-run'

// One issue's billed requests, priced and stamped, for the phase attribution to place
// (joshuafolkken/kit#1606).
//
// **It reuses `josh cost`'s own attribution rather than repeating it.** Which session's requests
// belong to which issue is decided by `cost_cli.attributed`, the same walk `pnpm josh cost --issue`
// reports from, so the dollar total printed beside the phases cannot drift from the one the cost
// command prints for the same run.
//
// **The read is opt-in, and that is a performance decision rather than a scoping one.** Loading the
// corpus walks every transcript in the checkout — 669 files and 296 MB when the span collector was
// last measured — so a batch scope calling it per child would pay that walk N times. `--issue` and
// the latest-run path opt in through `time_run.PRICED_SOURCES`; the epic, last-N and history paths
// do not, and their reports say the corpus was not read rather than reporting zero.
//
// **An unpriced model contributes no dollars, and the request says so rather than reporting a zero.**
// The pricing table cannot cost a model it does not know — the same treatment `cost_pricing.total_cost`
// gives it — so `is_priced` rides along and the block above the total prints how many requests were
// left out, which makes that total a floor rather than a figure nobody can check. Without it, a run on
// a model nobody has priced yet would print every phase at `$0.00`.
//
// **The walk was measured rather than estimated**: `pnpm josh cost --issue 1379` reads this project's
// whole transcript directory in about 3.0 s, which is what the two single-run scopes now pay. Putting
// the block behind a flag instead would have saved that and reproduced the defect this issue's epic is
// about — a shipped mechanism nobody reads.

const NO_COST = 0

function to_priced(record: UsageRecord): PricedRequest {
	const price = cost_pricing.resolve_price(record.model)

	return {
		at_ms: record.at_ms,
		cost_usd: price === undefined ? NO_COST : cost_pricing.estimate_cost(record.totals, price),
		is_priced: price !== undefined,
	}
}

function for_issue(cwd: string, issue_number: number): Array<PricedRequest> {
	return cost_cli
		.attributed(cost_cli.load_corpus(cwd))
		.filter((pair) => pair.issue === issue_number)
		.map((pair) => to_priced(pair.record))
}

// What the two single-run paths hand `time_run` — the only scopes for which one corpus walk is one
// walk. It sits here rather than beside `NO_SOURCES` so `time-run.ts` never imports the walk itself;
// the type comes back the other way, which is a type-only edge and no cycle at runtime.
const PRICED_SOURCES: RunSources = { found: undefined, search: undefined, priced_of: for_issue }

// How `time-run.ts` asks a source set for its prices. It reads the optional reader here rather than
// at the two call sites so neither of them carries the extra branch, and the type travels with the
// reader it describes.
type PricedReader = (cwd: string, issue_number: number) => ReadonlyArray<PricedRequest>

function priced_for(
	sources: RunSources,
	cwd: string,
	issue_number: number,
): ReadonlyArray<PricedRequest> | undefined {
	return sources.priced_of?.(cwd, issue_number)
}

const time_request_costs = { PRICED_SOURCES, to_priced, for_issue, priced_for }

export type { PricedReader }
export { time_request_costs }
