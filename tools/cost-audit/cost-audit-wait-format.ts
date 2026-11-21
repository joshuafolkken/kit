import { figure_format } from '#scripts/lib/figure-format'
import type { WaitRow, WaitTable } from './cost-audit-wait'

// The printed form of `cost-audit-wait.ts`'s tables (joshuafolkken/kit#8308): one table per key, each
// row a count of the after-wait rewrites with their cache write in dollars and tokens.

const TITLE_LEAD = 'Rewrites after a wait of 5 min or more by '
const TITLE_FIGURES = ' (this period: rewrites · cache write dollars · tokens)'

function row_line(row: WaitRow): string {
	const tokens = figure_format.format_tokens(row.tokens)

	return `  ${row.key}: ${String(row.count)} · ${figure_format.format_usd(row.usd)} · ${tokens} tokens`
}

function table_lines(table: WaitTable): Array<string> {
	const body = table.rows.length === 0 ? ['  none'] : table.rows.map((row) => row_line(row))

	return ['', `${TITLE_LEAD}${table.by}${TITLE_FIGURES}`, ...body]
}

function wait_lines(tables: ReadonlyArray<WaitTable>): Array<string> {
	return tables.flatMap((table) => table_lines(table))
}

const cost_audit_wait_format = { wait_lines }

export { cost_audit_wait_format }
