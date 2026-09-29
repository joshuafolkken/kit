import { readFile } from 'node:fs/promises'
import { git_stash, type StashEntry } from '#scripts/git/git-stash'
import { stash_orphans } from '#scripts/git/stash-orphans'
import { stash_sweep_lock } from '#scripts/git/stash-sweep-lock'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { run_tidy, type Outcome, type Verdict } from './run-tidy'
import type { IsMerged } from './run-tidy-lanes'

// The stash half of `josh run:tidy` (joshuafolkken/kit#2701): each entry whose named issues are all
// merged is dropped, and one that touches the observation ledger has its lines carried into the ledger
// first. The ledger is append-only and the digest counts repeats across it, so an entry's lines are
// never discarded with the entry.

// The same width `run-carry-stash.ts` reads issue states at.
const READ_CONCURRENCY = 8
const GONE_REASON = 'already dropped by another run'
const BUSY_REASON = 'another run held the stash sweep lock'

async function read_ledger(ledger_path: string): Promise<string> {
	try {
		return await readFile(ledger_path, 'utf8')
	} catch {
		return ''
	}
}

// An entry cut before joshuafolkken/kit#2724 holds its lines at the ledger's old path, so the lines of
// every ledger path it touches are carried to the current ledger.
async function added_ledger_lines(
	hash: string,
	ledger_paths: ReadonlyArray<string>,
): Promise<Array<string>> {
	const added: Array<string> = []

	for (const ledger_path of ledger_paths) {
		const lines = await git_stash.added_lines(hash, ledger_path)

		added.push(...lines)
	}

	return added
}

// How many ledger lines went into the primary checkout's ledger before the drop.
async function carry_ledger(hash: string): Promise<number> {
	const changed = await git_stash.changed_paths(hash)
	const ledger_paths = changed.filter((file_path) => observation_ledger.is_ledger_path(file_path))

	if (ledger_paths.length === 0) return 0

	const ledger_path = observation_ledger_home.ledger_path()
	const added = await added_ledger_lines(hash, ledger_paths)
	const carried = run_tidy.ledger_carry(added, await read_ledger(ledger_path))

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
