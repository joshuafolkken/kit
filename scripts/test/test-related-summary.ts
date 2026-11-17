import type { ReachedCount } from './test-pinned-reach'
import { related_scope, type RelatedScope } from './test-related-scope'

// The closing line of a `josh test:related` run (joshuafolkken/kit#7735): how many test files it ran,
// and the changed file that added the most of them with that number — so a run that widened to
// hundreds of files names its cause, and the ledger row keeps the same values for a caller that cut
// the output. A run of no tests and a full-suite run say so on the same line.

const UNKNOWN_COUNT = 'an unreported number of'

// The changed file adding the most test files, the first of a tie; none where no reach was read.
function widest_of(reach: ReadonlyArray<ReachedCount> | undefined): ReachedCount | undefined {
	return (reach ?? []).toSorted((first, second) => second.count - first.count)[0]
}

function selected_part(scope: RelatedScope, test_files: number | undefined): string {
	if (scope.mode === 'none') return '0 test files selected'
	const count = test_files === undefined ? UNKNOWN_COUNT : String(test_files)

	return `${count} test file(s) selected`
}

function widest_part(scope: RelatedScope, reach: ReadonlyArray<ReachedCount> | undefined): string {
	if (scope.mode === 'all') return ' — the full unit suite'
	const widest = scope.mode === 'related' ? widest_of(reach) : undefined

	if (widest === undefined) return ''

	return `, widest ${widest.file} (+${String(widest.count)})`
}

function summary_line(
	scope: RelatedScope,
	test_files: number | undefined,
	reach: ReadonlyArray<ReachedCount> | undefined,
): string {
	return `${related_scope.COMMAND_LABEL}: ${selected_part(scope, test_files)}${widest_part(scope, reach)}`
}

const test_related_summary = { summary_line, widest_of }

export { test_related_summary }
