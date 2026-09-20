// The measured metrics behind `josh pkg:scout` — the ranking of package candidates and the near-tie
// verdict that turns the Package-First "clearly best (Tier A) / genuine toss-up (Tier B)" branch from
// an impression into a computed answer (joshuafolkken/kit#2216).
//
// This module is the pure half: it takes candidates already gathered from the npm registry and
// answers two things — the order they rank in, and whether the top two are close enough that the
// choice is a Tier B question rather than a Tier A pick. The network reads live in
// `package-scout-cli.ts`, so the transform and the boundary are unit-tested without a registry.

// The relative lead below which the top two candidates are a near-tie. The registry's `score.final`
// is a relevance-weighted number of no fixed scale, so the gap is read as a fraction of the leader's
// score — `(top − second) / top` — rather than as an absolute difference. A leader ahead by less than
// this fraction is inside the noise, so the choice is the user's (Tier B) rather than the run's.
const NEAR_TIE_THRESHOLD = 0.15

// One candidate's registry facts, gathered per package: the version metadata (bundled types, license,
// unpacked size) that the search listing does not carry. Every field present, some absent as
// `undefined` — a fact the registry did not report is a blank in the row, never a scan that failed.
interface RegistryFacts {
	has_bundled_types: boolean
	license: string | undefined
	install_size_bytes: number | undefined
}

// A candidate as the search listing reports it: its name, the version searched, npm's composite score
// (the ranking key), and the version's publish date. The score is what the near-tie verdict reads.
interface SearchCandidate {
	name: string
	version: string
	score: number
	last_publish: string | undefined
}

// A candidate with every measured metric folded together, one row of the ranking table.
interface PackageMetrics {
	name: string
	version: string
	// npm's composite score (quality + popularity + maintenance), the ranking key.
	score: number
	weekly_downloads: number | undefined
	last_publish: string | undefined
	has_bundled_types: boolean
	license: string | undefined
	install_size_bytes: number | undefined
}

// `clear` — the top candidate leads by more than the near-tie threshold, so it is the Tier A pick.
// `close` — the top two are within it, so the choice is a Tier B question for the user.
type TierVerdict = 'clear' | 'close'

interface RankedTable {
	ranked: ReadonlyArray<PackageMetrics>
	// The relative lead of the top two, undefined when fewer than two candidates ranked.
	gap: number | undefined
	// The verdict, undefined when there is nothing to compare (0 or 1 candidate).
	verdict: TierVerdict | undefined
}

// The search listing and the per-package facts, folded into one row. The two are gathered from
// separate registry reads, so a candidate whose facts read failed still ranks on its search score.
function to_metrics(
	candidate: SearchCandidate,
	facts: RegistryFacts,
	weekly_downloads: number | undefined,
): PackageMetrics {
	return {
		name: candidate.name,
		version: candidate.version,
		score: candidate.score,
		last_publish: candidate.last_publish,
		has_bundled_types: facts.has_bundled_types,
		license: facts.license,
		install_size_bytes: facts.install_size_bytes,
		weekly_downloads,
	}
}

// Strongest first. Ties keep input order, which reads less arbitrarily than an unstable sort — and an
// equal score is exactly the near-tie the verdict then reports rather than something the order hides.
function rank(candidates: ReadonlyArray<PackageMetrics>): Array<PackageMetrics> {
	return [...candidates].toSorted((left, right) => right.score - left.score)
}

// The lead of the top candidate over the next as a fraction of the leader's score, or undefined when
// there is no pair to compare. Scaled by the leader so the threshold holds whatever the score's range:
// a leader whose score is zero has no lead over an equal runner-up, so the gap is zero (a near-tie).
function tie_gap(ranked: ReadonlyArray<PackageMetrics>): number | undefined {
	const [first, second] = ranked

	if (first === undefined || second === undefined) return undefined
	if (first.score <= 0) return 0

	return (first.score - second.score) / first.score
}

function verdict_of(gap: number | undefined): TierVerdict | undefined {
	if (gap === undefined) return undefined

	return gap < NEAR_TIE_THRESHOLD ? 'close' : 'clear'
}

// The whole answer: the candidates in order, the top-two gap, and whether that gap makes the choice a
// Tier A pick or a Tier B question.
function build_table(candidates: ReadonlyArray<PackageMetrics>): RankedTable {
	const ranked = rank(candidates)
	const gap = tie_gap(ranked)

	return { ranked, gap, verdict: verdict_of(gap) }
}

const package_scout = {
	NEAR_TIE_THRESHOLD,
	to_metrics,
	rank,
	tie_gap,
	verdict_of,
	build_table,
}

export type { PackageMetrics, RankedTable, RegistryFacts, SearchCandidate, TierVerdict }
export { package_scout }
