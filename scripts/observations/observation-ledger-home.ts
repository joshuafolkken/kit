import path from 'node:path'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { OBSERVATION_LEDGER_PATH } from './observation-ledger'

// Where the observation ledger is read and written, whichever work tree a command runs in
// (joshuafolkken/kit#2419).
//
// **The ledger lives in the primary checkout, never in a lane.** A lane is a linked work tree that is
// closed once its branch merges, and the ledger is excluded from ordinary staging — so a line appended
// in a lane had no route to the default branch: `pnpm josh followup`'s flush needs `pnpm josh ms`,
// which a lane refuses, and `lane:close` does not carry the file. Resolving the ledger to the primary
// checkout at every reader and writer puts the line where the flush already works, rather than adding
// a second route that moves it there afterwards.
//
// The primary checkout is `repo_discovery.main_worktree`'s answer, reused rather than spelled again;
// in an ordinary checkout it is the given directory itself, so nothing outside a lane changes.

function ledger_root(cwd: string = process.cwd()): string {
	return repo_discovery.main_worktree(cwd)
}

function is_lane(cwd: string = process.cwd()): boolean {
	return path.resolve(ledger_root(cwd)) !== path.resolve(cwd)
}

function ledger_path(cwd: string = process.cwd()): string {
	return path.join(ledger_root(cwd), OBSERVATION_LEDGER_PATH)
}

const observation_ledger_home = { is_lane, ledger_path, ledger_root }

export { observation_ledger_home }
