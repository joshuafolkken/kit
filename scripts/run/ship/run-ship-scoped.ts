import { gate_tree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'

// The scoped pair `josh ship` meets itself rather than stops on, shared by every stage that needs a
// green record for this tree: the preflight stage at the start, the review rounds, and the gate
// stage — a reviewer may have edited the tree after round 1's pair ran, and `josh gate` refuses a
// tree with no green record.

const SUCCESS_EXIT_CODE = 0
const should_forward_stderr = true

type Phase = () => Promise<JoshResult>

async function run_phases(phases: ReadonlyArray<Phase>): Promise<JoshResult> {
	let last: JoshResult = { code: SUCCESS_EXIT_CODE, out: '' }

	for (const phase of phases) {
		// eslint-disable-next-line no-await-in-loop -- phases run in order and the first failure stops the rest
		last = await phase()
		if (last.code !== SUCCESS_EXIT_CODE) return last
	}

	return last
}

// Only the checks with no green record for this tree run — the same question `review:brief` and the
// local gate refuse on — so a fresh record costs nothing and a stale or absent one costs a scoped run
// instead of a stop and a relaunched session. A check that genuinely fails still stops the ship, its
// output forwarded to the ship log.
async function scoped_pair(): Promise<JoshResult> {
	const tree = await gate_tree.read_gate_tree()
	const scripts = scoped_green.missing_scripts(tree.files, tree.base)

	return await run_phases(
		scripts.map(
			(script) => async () => await josh_command.josh_run([script], should_forward_stderr),
		),
	)
}

// The scoped pair and then `josh gate` — the gate stage, and the followup's gate over a merged tree
// before its push, so both leave the record the pre-push hook reuses.
async function scoped_gate(): Promise<JoshResult> {
	return await run_phases([
		scoped_pair,
		async () => await josh_command.josh_run(['gate'], should_forward_stderr),
	])
}

const run_ship_scoped = { run_phases, scoped_gate, scoped_pair }

export type { Phase }
export { run_ship_scoped }
