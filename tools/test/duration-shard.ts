// Splits the unit suite's test files into shards of equal recorded duration rather than equal file
// count (joshuafolkken/kit#4467). Vitest's own split hashes the paths and deals out the same number of
// files to each shard, so the slowest shard set the whole CI run while another sat idle for a minute.
//
// **Longest first, into the lightest shard** — the classic greedy split, deterministic because every
// tie breaks on the path and then the lower shard index. **A file with no record weighs the median of
// the recorded ones** (`FALLBACK_MS` with no record at all), so a new file lands by the same rule on
// every runner, and the shards still partition the suite exactly: each file is in exactly one.

type Durations = Readonly<Record<string, number>>

interface WeightedFile {
	file: string
	weight: number
}

const FALLBACK_MS = 1000
const HALF = 2

// The lower middle of an even count, so the weight is always one a recorded file has.
function median(values: ReadonlyArray<number>): number {
	const sorted = values.toSorted((left, right) => left - right)

	return sorted[Math.floor((sorted.length - 1) / HALF)] ?? FALLBACK_MS
}

function by_weight_then_path(left: WeightedFile, right: WeightedFile): number {
	if (left.weight !== right.weight) return right.weight - left.weight

	return left.file < right.file ? -1 : Number(left.file > right.file)
}

function weighted(files: ReadonlyArray<string>, durations: Durations): Array<WeightedFile> {
	const fallback = median(Object.values(durations))

	return [...new Set(files)]
		.map((file) => ({ file, weight: durations[file] ?? fallback }))
		.toSorted(by_weight_then_path)
}

function lightest(totals: ReadonlyArray<number>): number {
	let chosen = 0

	for (const [index, total] of totals.entries()) {
		if (total < (totals[chosen] ?? 0)) chosen = index
	}

	return chosen
}

// Every shard as a list of files, index 0 first.
function assign(
	files: ReadonlyArray<string>,
	durations: Durations,
	count: number,
): Array<Array<string>> {
	const shards = Array.from({ length: count }, (): Array<string> => [])
	const totals = Array.from({ length: count }, () => 0)

	for (const { file, weight } of weighted(files, durations)) {
		const target = lightest(totals)

		shards[target]?.push(file)
		totals[target] = (totals[target] ?? 0) + weight
	}

	return shards
}

// The files of shard `index` of `count`, 1-based as `--shard=<index>/<count>` is.
function shard_files(
	files: ReadonlyArray<string>,
	durations: Durations,
	index: number,
	count: number,
): Array<string> {
	return assign(files, durations, count)[index - 1] ?? []
}

const duration_shard = { FALLBACK_MS, assign, median, shard_files }

export type { Durations }
export { duration_shard }
