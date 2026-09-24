import type { StashEntry } from './git-stash'

// Which stashes nobody is coming back for (joshuafolkken/kit#2505). A parked or paused run pushes its
// work with a message `josh stash:pop` later targets, but an issue closed by another route leaves that
// entry with no run to pop it — the pile #2168 sorted by hand. This reads the owning issue out of each
// entry's subject so the closed ones, and the ones with no readable owner, can be put in front of a
// person. **Nothing here drops a stash**: the entry may hold work nobody recovered, so the decision stays
// with the person the report is printed for.

// The three shapes a run's stash subject takes, tried in this order. An explicit `#N` in the message
// (`backlogrun: parked #N`, `run:hold reclaimed before #N`) names the issue outright; a message that
// opens with `N: ` is `git_stash.work_message`'s; and a lane branch (`On N-lane: …`) names it by where
// the work was pushed from. A subject is `On <branch>: <message>` (or `WIP on <branch>: …` without
// `-m`), and a branch name carries no `:`, so `(?:^|: )` anchors the message start either way.
const MESSAGE_PATTERNS: ReadonlyArray<RegExp> = [/#(?<issue>\d+)\b/u, /(?:^|: )(?<issue>\d+): /u]
const BRANCH_PATTERN = /^(?:WIP on|On) (?<issue>\d+)-lane: /u
// A stash pushed without `-m` lists as `WIP on <branch>: <sha> <HEAD's commit subject>` — text no run
// wrote. This repository's commit subjects end in `#N` and merges read `Merge pull request #N`, so a
// message pattern there would name the last merged pull request, closed by definition, as the owner of
// live work. Only the branch can name the owner of such an entry.
const WIP_PREFIX = 'WIP on '

const HEADER =
	'Stashes whose issue is closed, or whose owner cannot be read — decide for each whether to revive or discard it (none is dropped automatically):'
const FOOTER =
	'Revive: `pnpm josh stash:pop "<message>"` · Discard: `git stash drop <selector>` — re-read the selector first, the stack is shared by every lane.'
const UNKNOWN_OWNER = 'owner unknown'
const COLUMN_SEPARATOR = '  '
const LINE_SEPARATOR = '\n'

interface OrphanStash {
	selector: string
	subject: string
	issue: string | undefined
}

function patterns_for(subject: string): ReadonlyArray<RegExp> {
	return subject.startsWith(WIP_PREFIX) ? [BRANCH_PATTERN] : [...MESSAGE_PATTERNS, BRANCH_PATTERN]
}

function issue_of(subject: string): string | undefined {
	for (const pattern of patterns_for(subject)) {
		const issue = pattern.exec(subject)?.groups?.['issue']

		if (issue !== undefined) return issue
	}

	return undefined
}

// Each owning issue once, so a stack holding two entries for one issue reads its state once.
function issues_of(entries: ReadonlyArray<StashEntry>): Array<string> {
	const issues = entries.map((entry) => issue_of(entry.subject))

	return [...new Set(issues.filter((issue): issue is string => issue !== undefined))]
}

// An entry is reported when its issue is in `closed`, or when it names no issue at all — an entry with
// no owner is exactly the one no run will ever pop. An open issue's entry is still some run's to resume.
function orphans(
	entries: ReadonlyArray<StashEntry>,
	closed: ReadonlySet<string>,
): Array<OrphanStash> {
	return entries
		.map((entry) => ({ ...entry, issue: issue_of(entry.subject) }))
		.filter((entry) => entry.issue === undefined || closed.has(entry.issue))
}

function format_line(orphan: OrphanStash): string {
	const owner = orphan.issue === undefined ? UNKNOWN_OWNER : `#${orphan.issue} closed`

	return `  ${[orphan.selector, owner, orphan.subject].join(COLUMN_SEPARATOR)}`
}

// `undefined` when there is nothing to report, so a clean stack prints nothing at all.
function format_report(found: ReadonlyArray<OrphanStash>): string | undefined {
	if (found.length === 0) return undefined

	return [HEADER, ...found.map((orphan) => format_line(orphan)), FOOTER].join(LINE_SEPARATOR)
}

const stash_orphans = { format_report, issue_of, issues_of, orphans }

export type { OrphanStash }
export { stash_orphans }
