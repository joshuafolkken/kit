import { cli_flags } from '#scripts/lib/cli-flags'

// The open's arguments after `--code-only`: `--unpinned-ok "<reason>"` (`run-review-pinned.ts`) and
// `--accept-metrics "<reason>"`, which records a metrics growth at the open instead of refusing it
// (`metrics-totals.ts` → `totals_refusal`, joshuafolkken/kit#7599). Each takes a non-blank reason.

const ACCEPT_METRICS_FLAG = '--accept-metrics'
const OPTIONS = {
	'unpinned-ok': { type: 'string' },
	'accept-metrics': { type: 'string' },
} as const

interface OpenArguments {
	unpinned_ok: string | undefined
	accept_metrics: string | undefined
}

function is_blank(value: string | undefined): boolean {
	return value?.trim() === ''
}

// `undefined` on a positional, an unknown flag, a flag with no value or a blank reason.
function parse(argv: ReadonlyArray<string>): OpenArguments | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined || parsed.positionals.length > 0) return undefined
	const unpinned_ok = parsed.values['unpinned-ok']
	const accept_metrics = parsed.values['accept-metrics']

	return is_blank(unpinned_ok) || is_blank(accept_metrics)
		? undefined
		: { unpinned_ok, accept_metrics }
}

const run_review_open_args = { ACCEPT_METRICS_FLAG, parse }

export type { OpenArguments }
export { run_review_open_args }
