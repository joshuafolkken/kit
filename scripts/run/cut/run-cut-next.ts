// The pre-gate cut's next action is printed beside its verdict; other modes keep their own protocol.
// An `unready` on `--deliverable` means the close condition is unmet: `run:chain` would carry the run on
// without the deliverable, so the next action is to meet the printed note and reissue the same close.
function unready_action(issue: string, gate: string, deliverable: string | undefined): string {
	if (deliverable === undefined) return gate

	return `meet the condition printed above, then rerun \`pnpm josh run:cut ${issue} --deliverable ${deliverable}\`.`
}

function print_next(verdict: string, issue: string, deliverable?: string): void {
	const gate = `pnpm josh run:chain ${issue}`
	const actions: ReadonlyMap<string, string> = new Map([
		['cut', 'End the turn immediately.'],
		['concluded', "End the turn; the parent's run:merge returns the lane."],
		['under-threshold', gate],
		['not-a-lane', gate],
		['unready', unready_action(issue, gate, deliverable)],
		['busy', 'Do not relaunch; a cut is already in flight.'],
		['failed', gate],
		['unknown', gate],
	])
	const action = actions.get(verdict)

	if (action !== undefined) console.error(`next: ${action}`)
}

const run_cut_next = { print_next }

export { run_cut_next }
