import { document_byte_budget } from '#scripts/document/document-byte-budget'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'

// Adding a command moves every artifact derived from the command map at once: the usage spans, the
// catalog, the command-map snapshot and `docs/why.md`'s counts. One command writes them all, and every
// test that finds one stale names it, so a failure never fixes one artifact and hides the next (#4970).

const DERIVE_COMMAND = 'pnpm josh command:derive'
const AGENT_AUDIENCE = 'automation'
const WHY_COUNTS =
	/there are \d+ `josh` commands, and \*\*\d+ of them are meant to be run by the agent/u

interface PageSize {
	path: string
	bytes: number
}

// `docs/why.md` quotes the size of the `josh` surface for scale, counted from the registry.
function why_counts_sentence(): string {
	const entries = Object.values(COMMAND_MAP)
	const total = String(entries.length)
	const agent = String(entries.filter((entry) => entry.reference[1] === AGENT_AUDIENCE).length)

	return `there are ${total} \`josh\` commands, and **${agent} of them are meant to be run by the agent`
}

function rewrite_why_counts(text: string): string {
	return text.replace(WHY_COUNTS, () => why_counts_sentence())
}

function is_over({ path, bytes }: PageSize): boolean {
	const ceiling = document_byte_budget.recorded_bytes_for(path)

	return ceiling !== undefined && bytes > ceiling
}

// A page's size beside its recorded ceiling, or the over-budget message naming the page.
function byte_line({ path, bytes }: PageSize): string {
	const ceiling = document_byte_budget.recorded_bytes_for(path)
	if (ceiling === undefined) return `${path}: ${String(bytes)} bytes, no ceiling recorded`
	const { over_budget_message } = document_byte_budget
	if (bytes > ceiling) return `over: ${over_budget_message(path, bytes, ceiling)}`
	const left = String(document_byte_budget.remaining_bytes(ceiling, bytes))

	return `${path}: ${String(bytes)} / ${String(ceiling)} bytes, ${left} left`
}

const derived_artifacts = {
	DERIVE_COMMAND,
	byte_line,
	is_over,
	rewrite_why_counts,
	why_counts_sentence,
}

export type { PageSize }
export { derived_artifacts }
