// The pre-gate cut's next action is printed beside its verdict; other modes keep their own protocol.
function print_next(verdict: string, issue: string): void {
	const gate = `pnpm josh run:chain ${issue}`
	const actions: ReadonlyMap<string, string> = new Map([
		['cut', 'End the turn immediately.'],
		['under-threshold', gate],
		['not-a-lane', gate],
		['unready', gate],
		['busy', 'Do not relaunch; a cut is already in flight.'],
		['failed', gate],
		['unknown', gate],
	])
	const action = actions.get(verdict)

	if (action !== undefined) console.error(`next: ${action}`)
}

const run_cut_next = { print_next }

export { run_cut_next }
