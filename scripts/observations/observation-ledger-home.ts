import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { OBSERVATION_LEDGER_PATH } from './observation-ledger'
import { observation_ledger_migrate } from './observation-ledger-migrate'

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

// **Resolving the path migrates the ledger first** (joshuafolkken/kit#2724). Every reader and writer
// asks here — `review:record --check`, `review:findings`, the retrospective, the stash carry's
// duplicate check — so none of them can read an empty new ledger while the lines still sit at the old
// path, which for the review-record check would answer `not-required` for a round never recorded.
function ledger_path(cwd: string = process.cwd()): string {
	const root = ledger_root(cwd)

	observation_ledger_migrate.migrate(root)

	return path.join(root, OBSERVATION_LEDGER_PATH)
}

// The one append every ledger writer goes through. A consumer that does not keep the ledger has no
// `docs/` at its root, so the parent is created first — the one write path that can bring the ledger
// into existence there (joshuafolkken/kit#2402).
async function append(target: string, lines: ReadonlyArray<string>): Promise<void> {
	if (lines.length === 0) return

	await mkdir(path.dirname(target), { recursive: true })
	await appendFile(target, `${lines.join('\n')}\n`, 'utf8')
}

const observation_ledger_home = { append, is_lane, ledger_path, ledger_root }

export { observation_ledger_home }
