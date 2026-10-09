import { git_stash, type StashEntry } from '#scripts/git/stash/git-stash'
import { stash_orphans } from '#scripts/git/stash/stash-orphans'
import { stash_sweep_lock } from '#scripts/git/stash/stash-sweep-lock'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { run_tidy, type Outcome, type Verdict } from './run-tidy'
import type { IsMerged } from './run-tidy-lanes'

// The stash half of `josh run:tidy`: each entry whose named issues are all merged is dropped, and one
// that touches the observation ledger has its lines carried into the ledger first. The ledger is
// append-only and the digest counts repeats across it, so an entry's lines are never discarded with
// the entry.

// The same width `run-carry-stash.ts` reads issue states at.
const READ_CONCURRENCY = 8
const GONE_REASON = 'already dropped by another run'
const BUSY_REASON = 'another run held the stash sweep lock'

// An older entry may hold its lines at an old single-file path, so the lines of every ledger path it
// touches are carried to the current ledger. The reads are independent, and the
// lines come back in path order however the reads finish.
async function added_ledger_lines(
	hash: string,
	ledger_paths: ReadonlyArray<string>,
): Promise<Array<string>> {
	const added = await bounded_pool.bounded_map(
		ledger_paths,
		READ_CONCURRENCY,
		async (ledger_path) => await git_stash.added_lines(hash, ledger_path),
	)

	return added.flat()
}

// How many ledger lines went into the running work tree's ledger before the drop. The duplicate check
// reads every issue's file, and the lines land in the file this tree writes, so
// the run's own commit takes them to the default branch.
async function carry_ledger(hash: string): Promise<number> {
	const changed = await git_stash.changed_paths(hash)
	const ledger_paths = changed.filter((file_path) => observation_ledger.is_ledger_path(file_path))

	if (ledger_paths.length === 0) return 0

	const ledger_path = await observation_ledger_home.writer_path(new Date())
	const added = await added_ledger_lines(hash, ledger_paths)
	const carried = run_tidy.ledger_carry(added, (await observation_ledger_home.read()) ?? '')

	await observation_ledger_home.append(ledger_path, carried)

	return carried.length
}

function carried_note(count: number): string {
	return count === 0 ? '' : ` (${String(count)} observation line(s) carried to the ledger)`
}

async function drop(entry: StashEntry): Promise<Outcome> {
	const carried = await carry_ledger(entry.selector)
	const target = `stash "${entry.subject}"${carried_note(carried)}`
	const is_dropped = await git_stash.drop_by_hash(entry.selector)

	return { target, verdict: is_dropped ? run_tidy.CLEAN : run_tidy.keep(GONE_REASON) }
}

async function merged_set(
	issues: ReadonlyArray<string>,
	is_merged: IsMerged,
): Promise<Set<string>> {
	const answers = await bounded_pool.bounded_map(
		issues,
		READ_CONCURRENCY,
		async (issue) => await is_merged(issue),
	)

	return new Set(issues.filter((_issue, index) => answers[index] === true))
}

function entry_verdict(entry: StashEntry, merged: ReadonlySet<string>): Verdict | undefined {
	const issues = stash_orphans.issues_named(entry.subject)

	return run_tidy.stash_verdict({ subject: entry.subject, issues }, merged)
}

async function tidy_entry(
	entry: StashEntry,
	merged: ReadonlySet<string>,
): Promise<Outcome | undefined> {
	const verdict = entry_verdict(entry, merged)

	if (verdict === undefined) return undefined

	if (verdict.kind === 'keep') return { target: `stash "${entry.subject}"`, verdict }

	try {
		return await drop(entry)
	} catch (error) {
		return { target: `stash "${entry.subject}"`, verdict: run_tidy.keep(String(error)) }
	}
}

async function tidy_entries(
	entries: ReadonlyArray<StashEntry>,
	merged: ReadonlySet<string>,
): Promise<Array<Outcome>> {
	const outcomes: Array<Outcome> = []

	for (const entry of entries) {
		// eslint-disable-next-line no-await-in-loop -- drops shift the stash stack and append to the same ledger
		const outcome = await tidy_entry(entry, merged)

		if (outcome !== undefined) outcomes.push(outcome)
	}

	return outcomes
}

// The report a sweep that never got the lock gives: every entry it would have dropped is kept.
function busy_outcome(entry: StashEntry, merged: ReadonlySet<string>): Outcome | undefined {
	const verdict = entry_verdict(entry, merged)

	if (verdict === undefined) return undefined

	return {
		target: `stash "${entry.subject}"`,
		verdict: verdict.kind === 'keep' ? verdict : run_tidy.keep(BUSY_REASON),
	}
}

function busy_outcomes(
	entries: ReadonlyArray<StashEntry>,
	merged: ReadonlySet<string>,
): Array<Outcome> {
	return entries
		.map((entry) => busy_outcome(entry, merged))
		.filter((outcome): outcome is Outcome => outcome !== undefined)
}

// Sequential drops under the repository-wide sweep lock: each resolves its position from its hash just
// before it goes, which holds only while no other sweep is shifting the stack or appending the same
// ledger lines. The GitHub reads stay outside the lock — they are the slow part and mutate nothing.
async function tidy_stashes(is_merged: IsMerged): Promise<Array<Outcome>> {
	const entries = await git_stash.list_by_hash()
	const issues = [...new Set(entries.flatMap((entry) => stash_orphans.issues_named(entry.subject)))]
	const merged = await merged_set(issues, is_merged)
	const outcomes = await stash_sweep_lock.with_lock(async () => await tidy_entries(entries, merged))

	return outcomes ?? busy_outcomes(entries, merged)
}

const run_tidy_stashes = { tidy_stashes }

export { run_tidy_stashes }
