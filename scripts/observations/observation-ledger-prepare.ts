import { observation_ledger_home } from './observation-ledger-home'
import { observation_ledger_line, type BrokenLine } from './observation-ledger-line'

// **What has to hold before a ledger line is committed, asked by every path that commits one**:
// `pnpm josh observations:flush`, the run's own commit in
// `scripts/git/git-staging.ts` and `pnpm josh followup`'s pre-merge ledger commit. Lines still on an
// old path are moved first, so the commit carries the
// move and the lines together, and every entry line is then parsed against the grammar
// — each caller decides what a broken line costs it.
//
// **A ledger that is not there has no line to break** — the change a status saw is then its deletion,
// and a commit carries that like any other change to it.
async function prepare(root: string): Promise<ReadonlyArray<BrokenLine>> {
	return observation_ledger_line.broken_ledger_lines(
		(await observation_ledger_home.read(root)) ?? '',
	)
}

const observation_ledger_prepare = { prepare }

export { observation_ledger_prepare }
