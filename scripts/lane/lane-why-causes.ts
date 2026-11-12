import { issue_cite } from '#scripts/issue/issue-cite'
import { lane_ci_path_stats } from './lane-ci-path-stats'
import type { LedgerEntry } from './lane-ledger'
import { lane_sinks_issues, type OpenIssue } from './lane-sinks-issues'

// The causes a lane's ship ran long on, as keys an open Issue is matched to by its title
// (joshuafolkken/kit#6679): the checks the ship log says failed, followup's main-move verdict, the
// gate's byte budget and the ledger's longest CI check. A key no open Issue names is unfiled.

interface KnownCause {
	key: string
	// The words besides the key an open Issue's title names this cause by.
	title?: ReadonlyArray<string>
	// A check name that is this cause.
	check?: RegExp
	// A ship log line that is this cause.
	log?: RegExp
}

// `followup-main-move.ts`'s verdict: `Not rerunning: main changed the failed tests …`.
const MAIN_CHANGED = 'main changed'
const KNOWN: ReadonlyArray<KnownCause> = [
	{ key: 'sonarqube', title: ['sonar'], check: /sonar/iu },
	{
		key: 'main move',
		title: ['main moved', MAIN_CHANGED, 'merge main'],
		log: new RegExp(`Not rerunning: ${MAIN_CHANGED}`, 'u'),
	},
	{ key: 'byte budget', log: /byte budget/iu },
]
// `git-pr-checks-eval.ts`'s `PR checks failed (failed checks: <a>, <b>; …).`, ended by the next
// reason or the closing `).` so a matrix name such as `Unit Tests (3/6)` stays whole.
const FAILED_CHECKS = /failed checks: (?<names>.+?)(?=; |\)\.$)/gmu
const NAME_SEPARATOR = ', '

function key_of(check: string): string {
	return KNOWN.find((known) => known.check?.test(check) === true)?.key ?? check.toLowerCase()
}

function failed_checks(log: string): Array<string> {
	return [...log.matchAll(FAILED_CHECKS)]
		.flatMap((match) => (match.groups?.['names'] ?? '').split(NAME_SEPARATOR))
		.map((name) => name.trim())
		.filter((name) => name !== '')
}

function log_keys(log: string | undefined): Array<string> {
	if (log === undefined) return []

	const verdicts = KNOWN.filter((known) => known.log?.test(log) === true)

	return [...failed_checks(log).map((check) => key_of(check)), ...verdicts.map(({ key }) => key)]
}

// `issue`'s cause keys, each once: from its ship `log` (`undefined` when gone) and its ledger rows.
function keys_of(
	entries: ReadonlyArray<LedgerEntry>,
	issue: number,
	log: string | undefined,
): Array<string> {
	const longest = lane_ci_path_stats.last_check_name(entries, issue)
	const ledger = longest === undefined ? [] : [key_of(longest)]

	return [...new Set([...log_keys(log), ...ledger])]
}

// The open Issues whose title names `key` or one of its known title words.
function issues_of(key: string, issues: ReadonlyArray<OpenIssue>): Array<OpenIssue> {
	const words = [key, ...(KNOWN.find((known) => known.key === key)?.title ?? [])]

	return issues.filter((issue) =>
		words.some((word) => issue.title.toLowerCase().includes(word.toLowerCase())),
	)
}

// The `#N` of each open Issue some key names, `none` when none does, `unread` when unread.
function open_cell(
	keys: ReadonlyArray<string>,
	issues: ReadonlyArray<OpenIssue> | undefined,
): string {
	if (issues === undefined) return lane_sinks_issues.UNREAD

	const numbers = new Set(keys.flatMap((key) => issues_of(key, issues)).map(({ number }) => number))

	return numbers.size === 0
		? lane_sinks_issues.NONE
		: [...numbers].map((number) => issue_cite.plain_for('linked', number)).join(NAME_SEPARATOR)
}

// The keys no open Issue names; `unread` when the listing was unreadable.
function unfiled_cell(
	keys: ReadonlyArray<string>,
	issues: ReadonlyArray<OpenIssue> | undefined,
): string {
	if (issues === undefined) return lane_sinks_issues.UNREAD

	return keys.filter((key) => issues_of(key, issues).length === 0).join(NAME_SEPARATOR)
}

const lane_why_causes = { keys_of, issues_of, open_cell, unfiled_cell }

export { lane_why_causes }
