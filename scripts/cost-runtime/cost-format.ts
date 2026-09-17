// The three figures a cost report prints — a dollar amount, a token count, a percentage share — and
// the precision each uses. Shared by the run-tree report modules and by `josh time`'s reports, which
// render the same figures.

const USD_DECIMALS = 4
const PERCENT_SCALE = 100
const PERCENT_DECIMALS = 1

function format_usd(usd: number): string {
	return `$${usd.toFixed(USD_DECIMALS)}`
}

function format_tokens(count: number): string {
	return count.toLocaleString('en-US')
}

function format_share(part: number, whole: number): string {
	if (whole === 0) return 'n/a'

	return `${((part / whole) * PERCENT_SCALE).toFixed(PERCENT_DECIMALS)}%`
}

const cost_format = {
	USD_DECIMALS,
	PERCENT_SCALE,
	PERCENT_DECIMALS,
	format_usd,
	format_tokens,
	format_share,
}

export { cost_format }
