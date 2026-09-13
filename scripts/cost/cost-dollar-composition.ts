import { cost_format } from './cost-format'
import { cost_pricing, type CostComposition, type ModelCost } from './cost-pricing'

// A run's dollars split by what they were spent on — fresh input, the two cache-write TTLs, cache
// reads, and output (joshuafolkken/kit#1912). `josh cost` already prints the *tokens* under each of
// these headings; this is the same split in money, which is the axis a hand measurement kept
// re-deriving because the report carried only the combined `cost_usd`.
//
// The five sum to the priced `cost_usd`: each term is `cost_pricing.estimate_composition`'s, priced
// by the same multipliers `estimate_cost` uses. A model whose id the price table does not carry
// contributes its tokens and no dollars, so `unpriced_models` marks the split a floor exactly as
// `cost_usd` is marked one elsewhere — never a silent zero read as "this run was free".
interface DollarComposition extends CostComposition {
	total_usd: number
	unpriced_models: Array<string>
}

const ZERO: CostComposition = {
	input_usd: 0,
	cache_write_5m_usd: 0,
	cache_write_1h_usd: 0,
	cache_read_usd: 0,
	output_usd: 0,
}

function add(left: CostComposition, right: CostComposition): CostComposition {
	return {
		input_usd: left.input_usd + right.input_usd,
		cache_write_5m_usd: left.cache_write_5m_usd + right.cache_write_5m_usd,
		cache_write_1h_usd: left.cache_write_1h_usd + right.cache_write_1h_usd,
		cache_read_usd: left.cache_read_usd + right.cache_read_usd,
		output_usd: left.output_usd + right.output_usd,
	}
}

function total_of(parts: CostComposition): number {
	return (
		parts.input_usd +
		parts.cache_write_5m_usd +
		parts.cache_write_1h_usd +
		parts.cache_read_usd +
		parts.output_usd
	)
}

// Per-model, then summed, for the reason `cost_by_model` is per-model: a run routinely mixes tiers,
// and one blended rate would misprice both. An unpriced model is recorded rather than dropped, so
// the caller can say the split is a floor.
function build(costs: ReadonlyArray<ModelCost>): DollarComposition {
	let parts = ZERO
	const unpriced: Array<string> = []

	for (const entry of costs) {
		const price = cost_pricing.resolve_price(entry.model)

		if (price === undefined) {
			unpriced.push(entry.model)
			continue
		}

		parts = add(parts, cost_pricing.estimate_composition(entry.totals, price))
	}

	return { ...parts, total_usd: total_of(parts), unpriced_models: unpriced }
}

const HEADING = 'Cost composition (dollars):'

function format(composition: DollarComposition): Array<string> {
	return [
		'',
		HEADING,
		`  uncached input   ${cost_format.format_usd(composition.input_usd)}`,
		`  cache write 5m   ${cost_format.format_usd(composition.cache_write_5m_usd)}`,
		`  cache write 1h   ${cost_format.format_usd(composition.cache_write_1h_usd)}`,
		`  cache read       ${cost_format.format_usd(composition.cache_read_usd)}`,
		`  output           ${cost_format.format_usd(composition.output_usd)}`,
	]
}

const cost_dollar_composition = { HEADING, build, format }

export type { DollarComposition }
export { cost_dollar_composition }
