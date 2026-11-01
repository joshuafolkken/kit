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

// What the parsed invocation carries into the announcement.
interface NotifyRequest {
	is_notified: boolean
	children: ReadonlyArray<number>
	title?: string | undefined
}

const SUCCESS_EXIT_CODE = 0

// The promoted epic's number, or `undefined` when the promotion failed and there is no epic to announce.
function promoted_number(exit_code: number, epic_number: number): number | undefined {
	return exit_code === SUCCESS_EXIT_CODE ? epic_number : undefined
}

// `--notify`'s send, made only once the epic exists — an epic whose number could not be read, or a
// promotion that failed (`undefined`), has nothing to announce, and says so.
async function announce(request: NotifyRequest, epic_number: number | undefined): Promise<void> {
	if (!request.is_notified) return

	if (epic_number === undefined) {
		console.error('⚠️  epic has no epic number to announce; no planning notification was sent.')

		return
	}

	await send({ epic_number, children: request.children, title: request.title })
}

const epic_notify = { announce, body_of, promoted_number, send }

export type { EpicNotice, NotifyRequest }
export { epic_notify }
