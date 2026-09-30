import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { OBSERVATION_LEDGER_PATH } from './observation-ledger'
import { observation_ledger_line, type BrokenLine } from './observation-ledger-line'
import { observation_ledger_migrate } from './observation-ledger-migrate'

// **What has to hold before a ledger line is committed, asked by both of the paths that commit one**
// (joshuafolkken/kit#2763): `pnpm josh observations:flush` and the run's own commit in
// `scripts/git/git-staging.ts`. Lines still on the old path are moved first (joshuafolkken/kit#2724),
// so the commit carries the move and the lines together, and every entry line is then parsed against
// the grammar (joshuafolkken/kit#2123) — each caller decides what a broken line costs it.
//
// **A ledger that is not there has no line to break** — the change a status saw is then its deletion,
// and a commit carries that like any other change to it.
async function read_ledger(root: string): Promise<string> {
	try {
		return await readFile(path.join(root, OBSERVATION_LEDGER_PATH), 'utf8')
	} catch {
		return ''
	}
}

async function prepare(root: string): Promise<ReadonlyArray<BrokenLine>> {
	observation_ledger_migrate.migrate(root)

	return observation_ledger_line.broken_ledger_lines(await read_ledger(root))
}

const observation_ledger_prepare = { prepare }

export { observation_ledger_prepare }
