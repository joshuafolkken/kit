import { metrics_ratchet } from './metrics-ratchet'

// `josh metrics --expect <total>=<growth> [--expect …] --reason "<why>"` — the growth a lane declares
// before its first gate (joshuafolkken/kit#8860). An issue that adds code knows at planning time that
// its totals grow, yet `--accept` records only a growth already measured, so nine lanes in ten stopped
// once on `metrics-totals`. A declaration is an ordinary approval whose growth is the ceiling: the
// ratchet compares against the largest approved growth, so a growth within it passes, and one past it
// or of a total it does not name still stops.

const EXPECT_FLAG = '--expect'
const REASON_FLAG = '--reason'
const PAIR_SEPARATOR = '='
// Every flag takes one value, so the argv is read two at a time.
const FLAG_WIDTH = 2
// `<total>=<growth>`
const ENTRY_PARTS = 2
const USAGE_LINE = 'josh metrics --expect <total>=<growth> [--expect …] --reason "<why>"'

interface Expectation {
	growth: Record<string, number>
	reason: string
}

type ExpectParse =
	{ kind: 'expect'; expectation: Expectation } | { kind: 'refused'; message: string }

function refused(message: string): ExpectParse {
	return { kind: 'refused', message: `josh metrics: ${message}` }
}

function flag_pairs(argv: ReadonlyArray<string>): ReadonlyArray<readonly [string, string]> {
	return Array.from({ length: Math.floor(argv.length / FLAG_WIDTH) }, (_, index) => [
		argv[index * FLAG_WIDTH] ?? '',
		argv[index * FLAG_WIDTH + 1] ?? '',
	])
}

function values_of(pairs: ReadonlyArray<readonly [string, string]>, flag: string): Array<string> {
	return pairs.filter(([name]) => name === flag).map(([, value]) => value)
}

function growth_of(parts: ReadonlyArray<string>): number | undefined {
	if (parts.length !== ENTRY_PARTS) return undefined

	const growth = Number(parts[1])

	return growth > 0 && Number.isFinite(growth) ? growth : undefined
}

// `undefined` for anything but a known total and a growth above zero.
function entry_of(text: string): [string, number] | undefined {
	const parts = text.split(PAIR_SEPARATOR)
	const [name = ''] = parts
	const growth = growth_of(parts)

	return growth !== undefined && metrics_ratchet.RATCHETED_NAMES.includes(name)
		? [name, growth]
		: undefined
}

function expectation_of(expects: ReadonlyArray<string>, reason: string): ExpectParse {
	const entries = expects.map((text) => ({ text, entry: entry_of(text) }))
	const bad = entries.find(({ entry }) => entry === undefined)

	if (bad !== undefined) {
		const names = metrics_ratchet.RATCHETED_NAMES.join(', ')

		return refused(`--expect ${bad.text} — name one of ${names} and a growth above 0`)
	}

	const growth = Object.fromEntries(entries.flatMap(({ entry }) => (entry ? [entry] : [])))

	return { kind: 'expect', expectation: { growth, reason } }
}

// `undefined` when argv is not the `--expect` form; a malformed one is refused with what it lacked,
// never read as another form.
function is_well_formed(
	argv: ReadonlyArray<string>,
	pairs: ReadonlyArray<readonly [string, string]>,
): boolean {
	const is_known = pairs.every(([flag]) => flag === EXPECT_FLAG || flag === REASON_FLAG)

	return argv.length % FLAG_WIDTH === 0 && is_known
}

// The one `--reason`, trimmed, or `undefined` when there is none, an empty one or more than one.
function single_reason(pairs: ReadonlyArray<readonly [string, string]>): string | undefined {
	const reasons = values_of(pairs, REASON_FLAG).map((reason) => reason.trim())
	const [reason = ''] = reasons

	return reason !== '' && reasons.length === 1 ? reason : undefined
}

function parse(argv: ReadonlyArray<string>): ExpectParse | undefined {
	if (argv[0] !== EXPECT_FLAG) return undefined

	const pairs = flag_pairs(argv)

	if (!is_well_formed(argv, pairs)) return refused(`usage: ${USAGE_LINE}`)

	const reason = single_reason(pairs)

	if (reason === undefined) return refused('--expect needs one non-empty --reason')

	return expectation_of(values_of(pairs, EXPECT_FLAG), reason)
}

const metrics_expect = { USAGE_LINE, parse }

export type { ExpectParse, Expectation }
export { metrics_expect }
