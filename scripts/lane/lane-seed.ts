// Which seat a lane gets (joshuafolkken/kit#1490, joshuafolkken/kit#1494).

// **The main work tree is seat 0, and nothing here can move it.** Lanes take seats 1..9, so a
// project that has never opened one stays on exactly the ports `ports/index.js` already gives it —
// `seed × 10` for its seed, the bases themselves for an unset seed, which is what CI runs on.
const FIRST_LANE_SEAT = 1
// **Nine seats, because the seat is the units digit of the offset `seed × 10 + lane`.** The seat no
// longer carries the whole port band — the seed does, multiplied by ten — so a lane holds a single
// seat number rather than an absolute seed, and there is no ceiling to check and no "multiple of
// ten" convention for anyone to break (joshuafolkken/kit#1494 removed the band mechanism).
const LAST_LANE_SEAT = 9

/**
 * The free seats, lowest first — the ones no live lane holds.
 *
 * **Read from the lanes themselves — never from a counter.** A number derived from how many lanes
 * have ever been opened hands a closed-and-reopened lane the seat a running lane is still using; the
 * seats here come from the `JOSH_LANE_SEAT` of each open work tree, so closing one frees its seat and
 * nothing else has to be told. **An empty result means the caller fails** — the range is never
 * wrapped, because wrapping is that same collision under a friendlier name.
 *
 * The whole ascending list is returned rather than only the lowest, because the caller claims each
 * seat atomically and steps to the next when a concurrent `lane:open` claimed it first
 * (joshuafolkken/kit#1494): reading a free set and picking from it are two moments, and the gap
 * between them is where two opens once chose the same seat.
 */
function free_seats(used: ReadonlyArray<number>): Array<number> {
	const taken = new Set(used)
	const free: Array<number> = []

	for (let seat = FIRST_LANE_SEAT; seat <= LAST_LANE_SEAT; seat += 1) {
		if (!taken.has(seat)) free.push(seat)
	}

	return free
}

const lane_seed_policy = {
	FIRST_LANE_SEAT,
	LAST_LANE_SEAT,
	free_seats,
}

export { lane_seed_policy }
