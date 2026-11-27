import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_label_schema } from '#scripts/git/git-schemas'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { issue_auto_ok } from '#scripts/issue/issue-auto-ok'
import { issue_handoff_filing } from '#scripts/issue/issue-handoff-filing'
import { AUTO_OK_LABEL, HANDOFF_IMPLEMENTING_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { z } from 'zod'
import type { WorkflowHandoff } from './run-handoff-args'

// A refused or failed `run:handoff <keyword> <N>` from a handed-off `fullrun` / `halfrun` / `prrun new`
// child ends that child, leaving its filing to the lane `backlogrun` opens (`run-entry-handoff-root.ts`).
// The filing carries `handoff:implementing`, which withholds `auto-ok`, so it is lifted and the filing's
// own `auto-ok` decision re-read without it (joshuafolkken/kit#9143). The label goes first: an `auto-ok`
// write failing after it leaves an issue `auto-ok:judge` reads again, never a stranded one.

// `fullrun #9143` — the keyword and one issue (`run-handoff-args.ts` writes the `#`).
const ISSUE_TOKEN = /^\S+ #(?<issue>\d+)$/u

const issue_schema = z.object({
	labels: z.array(issue_label_schema),
	body: z.string().nullish(),
})

interface FilingRead {
	labels: ReadonlyArray<string>
	body: string
}

function issue_of(handoff: WorkflowHandoff): string | undefined {
	return ISSUE_TOKEN.exec(handoff.line)?.groups?.['issue']
}

async function read_filing(issue: string): Promise<FilingRead | undefined> {
	const raw = await git_gh_command.issue_get_labels_and_body(issue)
	const parsed = parse_json_object_or_undefined(raw ?? '', issue_schema)

	if (parsed === undefined) return undefined

	return { labels: parsed.labels.map((label) => label.name), body: parsed.body ?? '' }
}

async function lifted(issue: string, read: FilingRead): Promise<string> {
	await git_gh_command.issue_remove_label(issue, HANDOFF_IMPLEMENTING_LABEL)

	const labels = read.labels.filter((label) => label !== HANDOFF_IMPLEMENTING_LABEL)
	const decision = issue_auto_ok.decide({
		is_opted_out: false,
		is_cross_repository: false,
		labels,
		body: read.body,
	})

	if (decision.is_applied) await git_gh_command.issue_apply_label(issue, AUTO_OK_LABEL)

	return `lifted \`${HANDOFF_IMPLEMENTING_LABEL}\` from ${session_cite.issue(issue)}; ${issue_auto_ok.line_of(decision)}`
}

// The line naming what the release did, or undefined when there was nothing to release.
async function release(
	handoff: WorkflowHandoff,
	environment: NodeJS.ProcessEnv,
): Promise<string | undefined> {
	const issue = issue_of(handoff)

	if (issue === undefined || !issue_handoff_filing.is_handed_off(environment)) return undefined

	const read = await read_filing(issue)

	if (read?.labels.includes(HANDOFF_IMPLEMENTING_LABEL) !== true) return undefined

	return await lifted(issue, read)
}

const run_handoff_release = { release }

export { run_handoff_release }
