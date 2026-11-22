import { epic_chain_kind } from '#scripts/epic/epic-chain-kind'

// joshuafolkken/kit#8661: a park option that files an Issue is one the parked Issue then waits on — its
// adopt records the blocked-by (`backlog-triage-filing.ts`), and the filed Issue's merge re-dispatches
// it. Carving a prerequisite off the parked Issue's own scope is a pure serial chain, which finishes later
// than one Issue (split-assessment.md → "The question", 3), so the adopt refuses it unless the option
// names one of the kinds an epic's declared order needs (`epic-chain-kind.ts`, the one judgment).

interface SerialOption {
	number: number
	order_reason?: string | undefined
}

const ORDER_REASON = /^- 順序の理由: ?(\S.*)$/u
const ORDER_LINE = '- 順序の理由: <kind> — <理由>'

// The order reason `line` carries; `undefined` for any other line.
function reason_of(line: string): string | undefined {
	return ORDER_REASON.exec(line)?.[1]?.trim()
}

// Why a parent may not adopt `option`, a filing when `is_filing`; `undefined` for a non-filing option or
// one whose order reason names its kind.
function problem_of(option: SerialOption, is_filing: boolean): string | undefined {
	if (!is_filing || epic_chain_kind.names_kind(option.order_reason ?? '')) return undefined

	return `option ${String(option.number)} files an Issue the parked one then waits on — a serial carve-off, slower than one Issue: the child keeps it one with \`lane:plan <N> --single "<why>"\` itself (split-assessment.md → "Over the guide before the gate"); a real prerequisite adds "${ORDER_LINE}" (<kind>: ${epic_chain_kind.kind_list()})`
}

// The schema line a filing option adds under it.
function schema_line(): string {
	return `   ${ORDER_LINE}   (a filing option the parked Issue waits on)`
}

const run_park_serial = { problem_of, reason_of, schema_line }

export { run_park_serial }
