import { telegram_notify, type TelegramSendInput } from './telegram-notify'

// What to type when the confirmation notification itself could not be delivered
// (joshuafolkken/kit#1564). The `--body-file` spelling rather than `--body`, because the body names
// commands and a backtick inside shell double quotes is evaluated before the command runs.
const CONFIRMATION_RECOVERY =
	'send it by hand — `pnpm josh notify --task-type confirmation --issue-url <url> ' +
	'--body-file <path>`'

interface TelegramContext {
	repo_name: string | undefined
	issue_title: string | undefined
	issue_url: string | undefined
	pr_url: string | undefined
}

function build_confirmation_input(input: {
	context: TelegramContext
	body: string
}): TelegramSendInput {
	return {
		task_type: 'confirmation',
		repo_name: input.context.repo_name,
		issue_title: input.context.issue_title,
		body: input.body,
		issue_url: input.context.issue_url,
		pr_url: input.context.pr_url,
	}
}

// **The tolerant send** (joshuafolkken/kit#1564). What stops the run is the blocker this
// notification is *about*, and it is raised by the caller — so a failed send must not replace that
// diagnosis with a Telegram error. It is reported and the caller's own stop still happens.
//
// Unlike the completion notification, this one *has* a recovery: a `confirmation` is exactly what
// `josh notify` is for, and the run stops here anyway, so re-sending it by hand loses nothing.
async function notify_confirmation(input: {
	context: TelegramContext
	body: string
}): Promise<void> {
	await telegram_notify.send_or_report(build_confirmation_input(input), CONFIRMATION_RECOVERY)
}

// A blank or whitespace-only reason is no reason at all: a bypass has to say something a person can
// audit later, so the emptiness check is what keeps `--…-ignore-reason ""` from being a silent pass.
function has_ignore_reason(reason: string | undefined): reason is string {
	return reason !== undefined && reason.trim().length > 0
}

// Shared by every `followup` gate that can stop the run — the AI review scan and, since
// joshuafolkken/kit#1578, the managed config-file gate. They ask the same two questions (was a reason
// given, and how is the confirmation sent), and a second copy of either answer is what lets the two
// gates drift apart.
const git_pr_confirmation = {
	notify_confirmation,
	build_confirmation_input,
	has_ignore_reason,
}

// `has_ignore_reason` stays a named export beside the namespace: `git-pr-coderabbit.ts` imports it
// from `git-pr-ai-review.ts`, which re-exports this one, and a namespace-only surface would make
// that re-export a property read.
export { git_pr_confirmation, has_ignore_reason }
export type { TelegramContext }
