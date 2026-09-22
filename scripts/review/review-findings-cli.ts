#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { OBSERVATION_LEDGER_PATH } from '#scripts/observations/observation-ledger'
import { review_finding_ledger, type CategoryCount } from './review-finding-ledger'

// `josh review:findings` — the reader over the review-finding ledger (joshuafolkken/kit#2325). It
// prints each recurring category's count, most frequent first, and the number of rounds that recorded
// zero findings — the denominator that tells a genuinely quiet category apart from one nobody looked
// at. The write half is `pnpm josh review:record`; both read one grammar from `review-finding-ledger`.

const NO_FINDINGS = 'no review findings recorded yet'

function count_line(entry: CategoryCount): string {
	return `  ${entry.category}: ${String(entry.count)}`
}

function zero_line(zero_rounds: number): string {
	return `zero-finding rounds recorded: ${String(zero_rounds)}`
}

function format_report(counts: ReadonlyArray<CategoryCount>, zero_rounds: number): string {
	if (counts.length === 0) {
		return zero_rounds === 0 ? NO_FINDINGS : zero_line(zero_rounds)
	}

	const body = counts.map((entry) => count_line(entry)).join('\n')

	return `findings by category:\n${body}\n${zero_line(zero_rounds)}`
}

async function read_ledger(ledger_path: string): Promise<string> {
	try {
		return await readFile(ledger_path, 'utf8')
	} catch {
		return ''
	}
}

async function run(ledger_path: string = OBSERVATION_LEDGER_PATH): Promise<number> {
	const content = await read_ledger(ledger_path)
	const counts = review_finding_ledger.category_counts(content)

	console.info(format_report(counts, review_finding_ledger.zero_round_count(content)))

	return 0
}

async function main(): Promise<void> {
	process.exitCode = await run()
}

const review_findings_cli = { NO_FINDINGS, format_report, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { review_findings_cli }
