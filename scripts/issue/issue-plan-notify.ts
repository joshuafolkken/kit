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

// The change section up to its first sub-heading.
function section_body(section: ReadonlyArray<string>): ReadonlyArray<string> {
	const lines = markdown_section.fence_free_lines(section.join('\n'))
	const end = lines.findIndex((line) => ANY_HEADING.test(line.trim()))

	return end === -1 ? lines : lines.slice(0, end)
}

// The section's first top-level items, as written; fenced lines never count. A plan without the
// section gives its own first items, so the message never shrinks to the `Next:` line alone.
function summary_of(plan: string): ReadonlyArray<string> {
	const section = markdown_section.section_lines_matching(plan, (line) =>
		CHANGE_HEADING.test(line.trim()),
	)
	const lines =
		section.length === 0 ? markdown_section.fence_free_lines(plan) : section_body(section)
	const items = lines.map((line) => TOP_LEVEL_ITEM.exec(line)?.groups?.['text'])

	return items.filter((item) => item !== undefined).slice(0, SUMMARY_ITEMS)
}

function body_of(notice: PlanNotice): string {
	const items = summary_of(notice.plan).map((item) => `- ${item}`)

	return [...items, run_stage.next_line(KICKOFF, notice.issue_number)].join('\n')
}

// A `planning` Telegram with its body already written. **One send for every planning announcement** —
// `issue:plan --planned` here and `epic --notify` (`epic-notify.ts`) — so the URL, the title and the
// failure handling cannot drift apart.
interface PlanningMessage {
	issue_number: string
	body: string
	title: string | undefined
	repo: string | undefined
	command: string
}

// The repository a message's URLs point at: `repo` when named, else the checkout's own.
async function slug_of(repo: string | undefined): Promise<string | undefined> {
	return repo ?? (await git_gh_repo.repo_get_name_with_owner())
}

// The send reads the title from the URL unless the message already names it.
async function values_of(message: PlanningMessage): Promise<CliValues> {
	const slug = await slug_of(message.repo)
	const url =
		slug === undefined ? {} : { 'issue-url': issue_cite.issue_url(slug, message.issue_number) }
	const title = message.title === undefined ? {} : { 'issue-title': message.title }

	return { 'task-type': 'planning', body: message.body, ...url, ...title }
}

// A failed send warns and leaves what the command recorded standing: the plan or the epic is the
// run's record, the message only its announcement.
async function send_planning(message: PlanningMessage): Promise<void> {
	try {
		await telegram_test.send_values(await values_of(message))
	} catch (error) {
		console.error(
			`⚠️  ${message.command} could not send the planning notification: ${String(error)}`,
		)
	}
}

// `--repo` names the repository the URL points at; without it, the checkout's own.
async function send(notice: PlanNotice): Promise<void> {
	await send_planning({ ...notice, body: body_of(notice), command: 'issue:plan' })
}

const issue_plan_notify = { summary_of, send, send_planning, slug_of }

export type { PlanNotice, PlanningMessage }
export { issue_plan_notify }
