#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { already_done_citation } from '#scripts/issue/already-done-citation'
import { issue_evidence_exit } from '#scripts/issue/issue-evidence-exit'
import { ALREADY_DONE_LABEL } from '#scripts/issue/issue-labels'
import { issue_sample_gate } from '#scripts/issue/issue-sample-gate'
import { session_cite } from '#scripts/issue/session-cite'

// `josh issue:already-done <N> --evidence-file <path>` — the exit for an Issue whose work is already
// merged (`issue-comments.md` → "When the work turns out to be already merged"): the evidence
// comment, the `already-done` label and the close, and the `run:release`, in that order
// (`issue-evidence-exit.ts`).
//
// **Evidence citing a merged pull request, or a commit on `origin/main`, closes the Issue as
// `completed`** (joshuafolkken/kit#7079, checked since joshuafolkken/kit#7093 and
// joshuafolkken/kit#7101 — `already-done-citation.ts`). A reopen undoes the close and
// the comment records why, so it is Tier A. The label goes on first and stays, so a closed Issue
// still shows it exited here; evidence that does not check leaves it OPEN with the label, for a
// person to close. The label is provisioned by `josh start`, so nothing here creates it.
//
// **A follow-up measurement is refused before anything is written** (joshuafolkken/kit#4504): its body
// declares the sample wait (`issue_sample_gate.DECLARATION`, read as `not-before` reads it), and its
// exit is `josh issue:measured`, which closes it — this one would leave it OPEN and the lane parked.

const ARGV_OFFSET = 2

function refusal_of(issue_number: string, body: string | undefined): string | undefined {
	const cite = session_cite.issue(issue_number)
	if (body === undefined) return `Issue ${cite} body not read; nothing written`
	if (issue_sample_gate.cited_number(body) === undefined) return undefined

	return `Issue ${cite} is a follow-up measurement (\`${issue_sample_gate.DECLARATION}\`): run \`josh issue:measured ${issue_number} --evidence-file <path>\` instead; nothing written`
}

async function admit(issue_number: string): Promise<boolean> {
	const refusal = refusal_of(issue_number, await git_gh_command.issue_get_body(issue_number))

	if (refusal !== undefined) console.error(refusal)

	return refusal === undefined
}

async function apply_label(issue_number: string): Promise<boolean> {
	const write = await git_gh_command.issue_apply_label(issue_number, ALREADY_DONE_LABEL)

	if (!write.is_applied) console.error(`${ALREADY_DONE_LABEL} not applied: ${write.reason}`)

	return write.is_applied
}

// A close that fails leaves the labelled OPEN Issue the unchecked evidence leaves: a person closes it.
async function label_then_close(issue_number: string, evidence: string): Promise<boolean> {
	const refusal = await already_done_citation.close_refusal(evidence)
	if (!(await apply_label(issue_number))) return false
	const left_open = `Issue ${session_cite.issue(issue_number)} left open with ${ALREADY_DONE_LABEL}`

	if (refusal !== undefined) console.info(`${left_open}: ${refusal}`)
	else if (!(await git_gh_command.issue_close(issue_number, undefined, 'completed'))) {
		console.error(`${left_open}: the close failed`)
	}

	return true
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	return await issue_evidence_exit.run(argv, {
		command: 'issue:already-done',
		finish: label_then_close,
		admit,
	})
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_already_done_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_already_done_cli }
