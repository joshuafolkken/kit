import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_plan_notify } from '#scripts/issue/issue-plan-notify'
import { epic_body } from './epic-body'

// `epic --notify`: the split path's `planning` Telegram — the epic's URL, every child's URL and the
// `backlogrun` line the split stops on. **The command sends it** rather than `kickoff` composing a
// `notify --body-file` by hand; the send is `issue:plan --planned`'s own.

interface EpicNotice {
	epic_number: number
	children: ReadonlyArray<number>
	title?: string | undefined
}

function body_of(notice: EpicNotice, slug: string): string {
	const rows = notice.children.map((child) => `- ${issue_cite.issue_url(slug, String(child))}`)

	return [...rows, `Next: ${epic_body.format_run_command(notice.epic_number)}`].join('\n')
}

// The epic lives in the repository the command runs in, so its children's URLs point there too. An
// unreadable repository leaves no URL to announce, so the send is skipped with a warning.
async function send(notice: EpicNotice): Promise<void> {
	const slug = await issue_plan_notify.slug_of(undefined)

	if (slug === undefined) {
		console.error('⚠️  epic could not read the repository; no planning notification was sent.')

		return
	}

	await issue_plan_notify.send_planning({
		issue_number: String(notice.epic_number),
		body: body_of(notice, slug),
		title: notice.title,
		repo: slug,
		command: 'epic',
	})
}

const epic_notify = { body_of, send }

export type { EpicNotice }
export { epic_notify }
