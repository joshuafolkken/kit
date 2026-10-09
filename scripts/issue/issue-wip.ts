import { INTERRUPT_ROUTE_LABEL, SPLIT_ROUTE_LABEL, TIER_A_ROUTE_LABEL } from './issue-labels'

// The WIP cap at the call that files. `josh issue:file` reads the count and asks the exemption
// question before anything is sent, the same hold `--distinct` places on a duplicate.
// What stays judgement — whether a filing is exempt — is declared by the route or by `--over-cap`.

// `WIP_CAP` is the number's single source; `wip-cap.md` states it once and a test pins the two equal.
const WIP_CAP = 30
const WITHIN = 'within'
const EXEMPT = 'exempt'
const HELD = 'held' as const

type WipVerdict = typeof WITHIN | typeof EXEMPT | typeof HELD

// Each route is an exempt category by definition: a prerequisite or upstream defect (`tier-a`) and a
// split child block the run, and an interrupt is one of the three tests. `review-cap` is the review
// round cap's branch 2, which `wip-cap.md` counts as discretionary, so it is held like no route at all.
const EXEMPT_ROUTES: ReadonlySet<string> = new Set([
	TIER_A_ROUTE_LABEL,
	SPLIT_ROUTE_LABEL,
	INTERRUPT_ROUTE_LABEL,
])

const HELD_MESSAGE =
	'✖ over the WIP cap: close one first; nothing honestly closable means do not file — a discretionary ' +
	'filing waits. An interrupt meeting one of three tests (a verification answers wrongly, a documented ' +
	'workflow cannot complete, or data is lost or written outside the repository) files with ' +
	'`--route interrupt`; a filing the run is blocked by reissues with `--over-cap`. Either way, state ' +
	'the overage (`prompts/collaboration-workflow/wip-cap.md`).'

const UNREAD_MESSAGE =
	'⚠ wip: could not count the open Issues — the filing goes on unchecked against the cap ' +
	'(`prompts/collaboration-workflow/wip-cap.md`).'

interface WipFiling {
	route: string | undefined
	is_over_cap: boolean
}

function is_exempt(filing: WipFiling): boolean {
	return filing.is_over_cap || (filing.route !== undefined && EXEMPT_ROUTES.has(filing.route))
}

// The cap is "more than `WIP_CAP` open", so exactly the cap is still within it.
function verdict_of(count: number, filing: WipFiling): WipVerdict {
	if (count <= WIP_CAP) return WITHIN

	return is_exempt(filing) ? EXEMPT : HELD
}

function count_line(count: number, repo: string, verdict: WipVerdict): string {
	return `wip: ${String(count)} open in ${repo} · cap ${String(WIP_CAP)} · ${verdict}`
}

// The listing's JSON is an array of rows; anything else is unreadable rather than zero, because zero
// would pass every filing as within the cap.
function count_of(json: string): number | undefined {
	try {
		const parsed: unknown = JSON.parse(json)

		return Array.isArray(parsed) ? parsed.length : undefined
	} catch {
		return undefined
	}
}

const issue_wip = { WIP_CAP, HELD, HELD_MESSAGE, UNREAD_MESSAGE, verdict_of, count_line, count_of }

export type { WipVerdict }
export { issue_wip }
