import { git_spawn } from '#scripts/git/git-spawn'
import { josh_command } from '#scripts/josh/josh-run'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'

// The one observation-ledger flush a `backlogrun` makes, at its end (joshuafolkken/kit#2492).
//
// A lane child used to flush after every merge (`run:tail`'s first step): a ledger-only branch, pull
// request and full CI run per issue, minutes each, for a file only the retrospective and the
// measurements read. The lanes now leave their lines appended in the primary checkout — the ledger's
// only home (`observation-ledger-home.ts`) — and `run:carry --end` commits them all in one pull request
// once the record is gone. `--end` is the batch's one end across every session cut, and the second
// `--end` finds no record and flushes nothing, so the flush is once per invocation.
//
// **It runs after the retrospective, not before**, and loses nothing by it: the retrospective reads the
// ledger file on disk (`retrospective-cli.ts` → `read_ledger`), not main, and the lines it stacks
// itself land in the same pull request. **A line a cut or a crash left unflushed is not lost either**:
// it is still a pending append in the primary checkout, and the next flush — this one, a later run's,
// or a single run's `followup` — sees it from `git status`, whichever run wrote it.
//
// **A failed flush is reported, never allowed to keep the record standing.** The lines stay on disk for
// the next flush, while a record that outlived its run would make the next `--begin` read `busy` — so
// `--end` clears the record before it flushes, and a flush killed mid-wait leaves only the lines.

const FLUSH_ARGV: ReadonlyArray<string> = ['observations:flush']
const SUCCESS_EXIT_CODE = 0
const FAILURE_NOTE =
	'The observation ledger flush failed; its lines stay in the primary checkout for the next flush (`pnpm josh observations:flush`).'

async function has_pending_append(): Promise<boolean> {
	const root = observation_ledger_home.ledger_root()
	const status = await git_spawn.read([
		'-C',
		root,
		'status',
		'--porcelain',
		'--untracked-files=normal',
	])

	return observation_ledger.has_pending_append(status)
}

// Standard output is `run:carry`'s one-token contract, so every word of the flush goes to standard
// error — the flush's own explanation is forwarded there, and its report is copied after it.
async function flush_ledger(): Promise<void> {
	try {
		if (!(await has_pending_append())) return

		const result = await josh_command.josh_run(FLUSH_ARGV, true)

		if (result.out.length > 0) console.error(result.out)

		if (result.code !== SUCCESS_EXIT_CODE) console.error(FAILURE_NOTE)
	} catch {
		console.error(FAILURE_NOTE)
	}
}

const run_carry_flush = { FAILURE_NOTE, FLUSH_ARGV, flush_ledger }

export { run_carry_flush }
