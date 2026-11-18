// A count per key, spent one at a time: each spent key accounts for one occurrence only, so a key
// that occurs twice on one side meets at most two on the other.

function of(keys: ReadonlyArray<string>): Map<string, number> {
	const counts = new Map<string, number>()

	for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)

	return counts
}

function take(counts: Map<string, number>, key: string): boolean {
	const left = counts.get(key) ?? 0

	if (left === 0) return false
	counts.set(key, left - 1)

	return true
}

const tally = { of, take }

export { tally }
