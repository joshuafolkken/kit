// Both steps run to their end before either's failure is thrown, so neither is left half-done behind
// the other's failure. The first step's failure is thrown when both failed.
async function settled_together(first: Promise<void>, second: Promise<void>): Promise<void> {
	const [result, other] = await Promise.allSettled([first, second])

	if (result.status === 'rejected') throw result.reason
	if (other.status === 'rejected') throw other.reason
}

export { settled_together }
