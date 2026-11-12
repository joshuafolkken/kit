import { cost_pricing, type ModelCost } from '#scripts/cost-runtime/cost-pricing'
import type { UsageRecord } from '#scripts/cost-runtime/cost-usage'

// A `josh cost:audit` row's dollars by the model that billed them and by token type
// (joshuafolkken/kit#6899), so a model switch or a context cut is priced against the term it moves
// rather than the row's total alone. Every figure is `cost_pricing.estimate_composition` over the
// rows `cost_by_model` groups, so the terms sum to `cost_pricing.cost_of` of the same requests. A model
// with no price row is left out, as `cost_of` leaves it out of the total.

interface ModelSpend {
	model: string
	input: number
	cache_read: number
	cache_write: number
	output: number
}

function spend_of_model(cost: ModelCost): ModelSpend | undefined {
	const price = cost_pricing.resolve_price(cost.model)

	if (price === undefined) return undefined

	const terms = cost_pricing.estimate_composition(cost.totals, price)

	return {
		model: cost.model,
		input: terms.input_usd,
		cache_read: terms.cache_read_usd,
		cache_write: terms.cache_write_5m_usd + terms.cache_write_1h_usd,
		output: terms.output_usd,
	}
}

function total_of(spend: ModelSpend): number {
	return spend.input + spend.cache_read + spend.cache_write + spend.output
}

// The requests' dollars by billed model, the costliest first.
function spend_of(records: ReadonlyArray<UsageRecord>): Array<ModelSpend> {
	return cost_pricing
		.cost_by_model(records)
		.map((cost) => spend_of_model(cost))
		.filter((spend) => spend !== undefined)
		.toSorted((left, right) => total_of(right) - total_of(left))
}

const cost_audit_spend = { spend_of, total_of }

export type { ModelSpend }
export { cost_audit_spend }
