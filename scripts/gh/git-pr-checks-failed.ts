import { FAILURE_REASON_CHECKS } from './git-pr-checks-eval'

// The check names a failed checks wait reported — `git-pr-checks-eval.ts`'s `PR checks failed
// (failed checks: <a>, <b>; …).` — read back by `josh lane:why` from a ship log and by `josh ship` into
// a followup `check` stop's record (joshuafolkken/kit#7333). The list ends at the next reason or the
// closing `).`, so a matrix name such as `Unit Tests (3/6)` stays whole.

const FAILED_CHECKS = new RegExp(`${FAILURE_REASON_CHECKS}: (?<names>.+?)(?=; |\\)\\.$)`, 'gmu')
const NAME_SEPARATOR = ', '

// Every check name `text` lists as failed, in order, each list read whole.
function names_of(text: string): Array<string> {
	return [...text.matchAll(FAILED_CHECKS)]
		.flatMap((match) => (match.groups?.['names'] ?? '').split(NAME_SEPARATOR))
		.map((name) => name.trim())
		.filter((name) => name !== '')
}

const git_pr_checks_failed = { names_of }

export { git_pr_checks_failed }
