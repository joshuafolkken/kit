import { issue_cite } from '#scripts/issue/issue-cite'
import { lane_reap } from '#scripts/lane/lane-reap'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { run_hold_live, type LiveHold } from '#scripts/run/hold/run-hold-live'
import { git_command } from './git-command'

// joshuafolkken/kit#9106: **`main:sync` switches a checkout to the default branch only when nothing in
// it is in use.** `git checkout <default>` carries every uncommitted change that does not conflict, so a
// root checkout held by a run, 140 changes deep on its ship branch, was moved to the default branch
// with its work in tow — by whichever post-merge step ran `main:sync` there. Every caller reaches the
// checkout through this one place, so the refusal lives here rather than in each of them.
//
// **What still switches:** the observation ledger's appended lines, which `run:tail`'s flush relies on
// the checkout carrying over (`main-sync.ts` → `fast_forward_quietly`), and a hold of the caller's own
// run — `run:tail` closes its run from the branch it shipped while its hold is still live. A stale
// hold names no running process (`run-hold-live.ts`), so a clean tree under one switches as before.

interface SwitchReaders {
	branch: () => Promise<string>
	status: () => Promise<string>
	live_hold: () => Promise<LiveHold | undefined>
	ancestry: () => ReadonlySet<number>
}

const DEFAULT_READERS: SwitchReaders = {
	branch: async () => await git_command.branch(),
	status: async () => await git_command.status(),
	live_hold: async () => run_hold_live.live_hold(await git_command.repository_root()),
	ancestry: () => lane_reap.own_ancestry(),
}

function changes_reason(others: ReadonlyArray<string>): string {
	return `it has ${String(others.length)} uncommitted change(s) outside the observation ledger (${others.join(', ')}), which the checkout would carry onto the default branch. Commit them or set them aside first.`
}

function hold_reason(hold: LiveHold): string {
	const issue = issue_cite.plain_for('terminal', hold.issue)

	return `it is held by the live run for ${issue} (pid ${String(hold.pid)}). Let that run finish first.`
}

async function foreign_hold_reason(readers: SwitchReaders): Promise<string | undefined> {
	const hold = await readers.live_hold()

	if (hold === undefined || readers.ancestry().has(hold.pid)) return undefined

	return hold_reason(hold)
}

// Uncommitted work is named first: it is what the checkout would actually move.
async function in_use_reason(readers: SwitchReaders): Promise<string | undefined> {
	const others = observation_ledger.other_paths(await readers.status())

	if (others.length > 0) return changes_reason(others)

	return await foreign_hold_reason(readers)
}

/** Why this checkout must not be switched from its branch to `default_branch`, or `undefined` when it may. */
async function refusal(
	default_branch: string,
	readers: SwitchReaders = DEFAULT_READERS,
): Promise<string | undefined> {
	const current = await readers.branch()

	if (current === default_branch) return undefined

	const reason = await in_use_reason(readers)

	return reason && `josh main:sync will not switch ${current} to ${default_branch}: ${reason}`
}

const main_sync_switch = { refusal }

export { main_sync_switch }
export type { SwitchReaders }
