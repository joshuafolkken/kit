import { git_gh_command } from '#scripts/gh/git-gh-command'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { has_label_name, has_parked_label, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { epic_busy, type BusyRead } from './epic-busy'
import type { EpicNextResult } from './epic-report'
import { epic_solo, type SoloGate } from './epic-solo'

// A parked `run:solo` issue keeps the `run:solo` gate held (joshuafolkken/kit#7855).
//
// Parking strips `in-progress` (`run-merge-cli.ts` `on_parked`), so `epic_solo.select`, which reads
// the `in-progress` holders, sees no solo run and would offer every lane on the still-broken
// verification path. The hold is read off the issue itself instead — OPEN, `run:solo`, a park label —
// so it ends exactly when a person resolves it: the fix merges, the issue is closed, `run:solo` is
// removed, or the park label is lifted and the issue is offered alone again.
//
// A listing that cannot be read holds, the fail-safe answer `epic_busy` gives.

const LISTING_LIMIT = 100

function is_parked_solo(issue: OpenIssueData): boolean {
	const labels = (issue.labels ?? []).map((label) => label.name)

	return has_label_name(labels, RUN_SOLO_LABEL) && has_parked_label(labels)
}

async function read(repo: string): Promise<BusyRead> {
	const { json, is_capped } = await git_gh_command.issue_list_by_label_in_repo(
		RUN_SOLO_LABEL,
		LISTING_LIMIT,
		repo,
	)

	if (json === undefined) return { kind: 'unreadable' }

	return epic_busy.parse_listing(json, is_capped, is_parked_solo)
}

function unread_message(repo: string): string {
	return `Could not read the whole \`${RUN_SOLO_LABEL}\` listing for ${repo}, so a parked \`${RUN_SOLO_LABEL}\` issue cannot be ruled out — nothing is offered here; check \`gh auth status\` and ask again.`
}

function message_of(parked: BusyRead, repo: string): string | undefined {
	if (parked.kind === 'idle') return undefined
	if (parked.kind !== 'busy') return unread_message(repo)

	return epic_solo.parked_message(
		parked.issues.map((issue) => issue.number),
		repo,
	)
}

// Why nothing may start in `repo`, when a parked `run:solo` issue holds it.
async function notice(repo: string): Promise<string | undefined> {
	return message_of(await read(repo), repo)
}

// `backlog:next`'s hold: every candidate withheld while a parked `run:solo` issue is open.
async function hold(result: EpicNextResult, repo: string): Promise<SoloGate | undefined> {
	if (result.verdict !== 'run') return undefined

	const held = await notice(repo)

	if (held === undefined) return undefined

	return epic_solo.gate(result, { kind: 'idle' }, repo, (children) =>
		epic_solo.none_of(children, held),
	)
}

const epic_solo_parked = { hold, notice }

export { epic_solo_parked }
