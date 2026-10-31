import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { issue_cite } from '#scripts/issue/issue-cite'
import { markdown_section } from '#scripts/issue/markdown-section'
import { telegram_test } from '#scripts/notify/telegram-test'
import type { CliValues } from '#scripts/notify/telegram-test-logic'
import { run_stage } from '#scripts/run/run-stage'

// The `planning` Telegram `issue:plan --planned` sends once the plan is recorded: the first items of
// the plan's change section and the `Next:` line `kickoff` stops on. **The command sends it** rather
// than `kickoff` composing a `notify --body=$'…'` by hand from the plan it had just written.

// The change section, at either level a plan writes it — the `##` or the plan's own `###` heading.
const CHANGE_HEADING = /^#{2,3}\s+変更\s*$/u
const ANY_HEADING = /^#{1,6}\s/u
// A top-level list item; an indented one is a detail of the item above it.
const TOP_LEVEL_ITEM = /^(?:[-*+]|\d+\.)\s+(?<text>\S.*)$/u
const SUMMARY_ITEMS = 3
const KICKOFF = 'kickoff'

interface PlanNotice {
	issue_number: string
	plan: string
	title: string | undefined
	repo: string | undefined
}

// The section's first top-level items, as written; fenced lines never count.
function summary_of(plan: string): ReadonlyArray<string> {
	const raw = markdown_section.section_lines_matching(plan, (line) =>
		CHANGE_HEADING.test(line.trim()),
	)
	const lines = markdown_section.fence_free_lines(raw.join('\n'))
	const end = lines.findIndex((line) => ANY_HEADING.test(line.trim()))
	const items = (end === -1 ? lines : lines.slice(0, end)).map(
		(line) => TOP_LEVEL_ITEM.exec(line)?.groups?.['text'],
	)

	return items.filter((item) => item !== undefined).slice(0, SUMMARY_ITEMS)
}

function body_of(notice: PlanNotice): string {
	const items = summary_of(notice.plan).map((item) => `- ${item}`)

	return [...items, run_stage.next_line(KICKOFF, notice.issue_number)].join('\n')
}

// `--repo` names the repository the URL points at; without it, the checkout's own. The send reads the
// title from that URL unless `--title` already named it.
async function values_of(notice: PlanNotice): Promise<CliValues> {
	const slug = notice.repo ?? (await git_gh_repo.repo_get_name_with_owner())
	const url =
		slug === undefined ? {} : { 'issue-url': issue_cite.issue_url(slug, notice.issue_number) }
	const title = notice.title === undefined ? {} : { 'issue-title': notice.title }

	return { 'task-type': 'planning', body: body_of(notice), ...url, ...title }
}

// A failed send warns and leaves the recorded plan standing: the plan is the run's record, the
// message only its announcement.
async function send(notice: PlanNotice): Promise<void> {
	try {
		await telegram_test.send_values(await values_of(notice))
		console.info('notify: planning')
	} catch (error) {
		console.error(`⚠️  issue:plan could not send the planning notification: ${String(error)}`)
	}
}

const issue_plan_notify = { summary_of, send }

export type { PlanNotice }
export { issue_plan_notify }
