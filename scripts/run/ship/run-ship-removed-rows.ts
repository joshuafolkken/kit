import { readFile, writeFile } from 'node:fs/promises'
import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { removed_tests } from '#scripts/review/removed-tests'
import { removed_tests_check } from '#scripts/review/removed-tests-check'
import { run_ship_body_draft } from './run-ship-body-draft'

// **The tests a change removed, shown where a run passes before `josh ship`** — the end of a green
// `josh test:related`. Their disposition rows were first asked at the ship's preflight, after the
// pre-detach checks had run, and every lane that renamed a test stopped there and shipped again
// (joshuafolkken/kit#4563). The removed titles are `removed_tests_check.read()`'s, and the pending
// rows go into the branch's ship body draft, so the run only replaces each ending; the preflight still
// refuses a row left pending.

async function draft_of_branch(): Promise<string | undefined> {
	const issue_number = git_branch.issue_from_branch(await git_command.branch())

	if (issue_number === undefined) return undefined

	return await run_ship_body_draft.existing(String(issue_number))
}

async function body_of(draft: string | undefined): Promise<string> {
	return draft === undefined ? '' : await readFile(draft, 'utf8')
}

// An unreadable base lists nothing here — the preflight refuses on it — and outside a repository it
// keeps the branch, which git could not answer, from being asked at all.
async function removed_titles(): Promise<ReadonlyArray<string>> {
	return (await removed_tests_check.read()) ?? []
}

function where(draft: string | undefined): string {
	return draft === undefined
		? 'Put these rows into the pull request body'
		: `Pending rows for them are in the ship body draft ${draft}`
}

function notice(titles: ReadonlyArray<string>, draft: string | undefined): string {
	return [
		`Removed tests — this change removes ${String(titles.length)} test(s) the ship body does not dispose of yet. ${where(draft)}; replace each ending, ${removed_tests.ROW_FORMAT}, or the \`josh ship\` preflight refuses:`,
		...titles.map((title) => `  - ${title}`),
	].join('\n')
}

async function surface(): Promise<void> {
	const removed = await removed_titles()

	if (removed.length === 0) return
	const draft = await draft_of_branch()
	const body = await body_of(draft)
	const titles = removed_tests.undisposed(removed, body)

	if (titles.length === 0) return
	if (draft !== undefined) await writeFile(draft, removed_tests.with_pending_rows(body, titles))
	console.info(notice(titles, draft))
}

const run_ship_removed_rows = { surface }

export { run_ship_removed_rows }
