import { document_byte_budget } from '#scripts/document/document-byte-budget'

// Adding a command moves every artifact derived from the command map at once: the usage spans and the
// catalog. One command writes them all, and every
// test that finds one stale names it, so a failure never fixes one artifact and hides the next (#4970).

const DERIVE_COMMAND = 'pnpm josh command:derive'

interface PageSize {
	path: string
	bytes: number
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
}

export type { PageSize }
export { derived_artifacts }
