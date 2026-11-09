import type { CoreRateLimit, RateLimitResources } from '#scripts/gh/gh-core-rate-limit'
import type { Transport } from '#scripts/gh/git-gh-transport'
import { figure_format } from '#scripts/lib/figure-format'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_board_machine } from './run-board-machine'
import { run_board_render_quota_cell, type Cell } from './run-board-render-quota-cell'

// The `⛽ usage` section's github row (joshuafolkken/kit#6559, joshuafolkken/kit#6822): GitHub's REST
// core allowance and its GraphQL one, each with its own limit and reset, as two gauges on one row in
// the usage rows' columns, each with what is left — `REST   4% ■──┊── 4787     10:55  ▶ GraphQL   1%
// ┊──── 4952     11:02` (joshuafolkken/kit#6828). ▶ marks the transport the session reads through.
// ▶ (U+25B6) is kept although some terminals draw it two columns wide: the board's ↻, ┊ and ■ are
// ambiguous-width already, so a `>` fallback would mend one symbol of four.

const { minute_of } = figure_format
const WINDOW_MINUTES = 60
// Both allowances refill hourly.
const WINDOW_MS = WINDOW_MINUTES * MS_PER_MINUTE
const PERCENT = 100
const RESET_MARK = '↻'
const TRANSPORT_MARK = '▶'
const SEPARATOR = ' · '
const LEGEND_ENTRY = `${TRANSPORT_MARK} transport`
// The transports' names as drawn, in their proper case; the keys stay lower case.
const TRANSPORT_NAMES: Readonly<Record<Transport, string>> = { rest: 'REST', graphql: 'GraphQL' }

// The allowances with the session's transport; no transport where it could not be read.
interface GithubRateLimit extends RateLimitResources {
	transport?: Transport | undefined
}

// One allowance as drawn: the percent spent, ┊, what is left, `used/limit` and the reset time.
interface Allowance {
	label: string
	used_percent: number
	pace: number
	left: number
	spent: string
	reset: string
}

function label_of(resource: Transport, transport: Transport | undefined): string {
	const name = TRANSPORT_NAMES[resource]

	return resource === transport ? `${TRANSPORT_MARK} ${name}` : name
}

// How far through the hour-long window the clock is, 0 to 1.
function pace_of(reset_ms: number, now_ms: number): number {
	return Math.min(1, Math.max(0, 1 - (reset_ms - now_ms) / WINDOW_MS))
}

// A reading whose reset has passed has spent none, has all of its limit left and has no reset: the next
// window starts at the next call (joshuafolkken/kit#6621).
function allowance_of(label: string, rate_limit: CoreRateLimit, now_ms: number): Allowance {
	const { limit, remaining, reset_ms } = rate_limit
	const is_open = reset_ms > now_ms
	const used = is_open ? limit - remaining : 0

	return {
		label,
		used_percent: (used / limit) * PERCENT,
		pace: is_open ? pace_of(reset_ms, now_ms) : 0,
		left: limit - used,
		spent: `${String(used)}/${String(limit)}`,
		reset: is_open ? minute_of(reset_ms) : '',
	}
}

// REST first, then GraphQL where it was read.
function allowances_of(github: GithubRateLimit, now_ms: number): Array<Allowance> {
	const { core, graphql, transport } = github
	const rest = allowance_of(label_of('rest', transport), core, now_ms)

	return graphql === undefined
		? [rest]
		: [rest, allowance_of(label_of('graphql', transport), graphql, now_ms)]
}

function joined(parts: ReadonlyArray<string>): string {
	return parts.filter((part) => part !== '').join(' ')
}

function cell_of({ label, used_percent, pace, left, reset }: Allowance): Cell {
	return { label, used_percent, pace, count: String(left), reset }
}

// `REST   4% ■──┊── 4787     10:55  ▶ GraphQL …`: the row after the GitHub name.
function row_text(github: GithubRateLimit, now_ms: number): string {
	const allowances = allowances_of(github, now_ms)

	return run_board_render_quota_cell.row_text(allowances.map((allowance) => cell_of(allowance)))
}

// `REST 4% 213/5000 ↻10:55 · ▶ GraphQL 1% 48/5000 ↻11:02`: the folded line's GitHub part.
function summary_text(github: GithubRateLimit, now_ms: number): string {
	return allowances_of(github, now_ms)
		.map(({ label, used_percent, spent, reset }) =>
			joined([
				label,
				run_board_machine.percent_text(used_percent).trimStart(),
				spent,
				reset === '' ? '' : `${RESET_MARK}${reset}`,
			]),
		)
		.join(SEPARATOR)
}

const run_board_render_quota_github = { LEGEND_ENTRY, row_text, summary_text }

export { run_board_render_quota_github }
export type { GithubRateLimit }
