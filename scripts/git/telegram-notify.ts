import { z } from 'zod'

const TELEGRAM_API_BASE = 'https://api.telegram.org'

const telegram_environment_schema = z.object({
	telegram_bot_token: z.string().min(1, { message: 'TELEGRAM_BOT_TOKEN is required' }),
	telegram_chat_id: z.string().min(1, { message: 'TELEGRAM_CHAT_ID is required' }),
})

// **`warning` is not `failure`** (joshuafolkken/kit#1628). It names a run that finished and merged,
// alongside something that did not work — the run report that never reached `.time-history.jsonl` is
// the first of them. Sending `failure` (❌) there would say the merge failed, which is false and is
// the more expensive lie of the two; sending `completion` (✅) twice says nothing went wrong, which
// is the silence this type exists to end.
type TelegramTaskType =
	'planning' | 'completion' | 'failure' | 'warning' | 'kickoff_retry' | 'confirmation'

interface TelegramSendInput {
	task_type: TelegramTaskType
	repo_name: string | undefined
	issue_title: string | undefined
	body: string | undefined
	issue_url: string | undefined
	pr_url: string | undefined
}

interface TelegramConfig {
	bot_token: string
	chat_id: string
}

interface TaskDefinition {
	icon: string
	label: string
}

const TASK_DEFINITIONS: Record<TelegramTaskType, TaskDefinition> = {
	planning: { icon: '📋', label: 'Planning' },
	completion: { icon: '✅', label: 'Completion' },
	failure: { icon: '❌', label: 'Failure' },
	warning: { icon: '⚠️', label: 'Completed with a warning' },
	kickoff_retry: { icon: '🔄', label: 'Kickoff retry' },
	confirmation: { icon: '⏸️', label: 'Confirmation required' },
}

const NOT_CONFIGURED_PREFIX = 'Telegram is not configured'
const SEND_FAILED_PREFIX = 'Telegram notification failed'
const REDACTED = '<redacted>'
const UNKNOWN_ERROR_TEXT = 'unknown error'

function parse_environment_string(value: string | undefined): string {
	return value?.trim() ?? ''
}

// Not `git_gh_helpers.get_error_message_with_stderr`, which the two nearest callers use: that one
// appends the `stderr` an execa-shaped error carries, and nothing in this module runs a subprocess —
// so it would pull a subprocess concern into an HTTP one and degrade to exactly this line anyway.
// **The `cause` is read, not only the message.** A `fetch` rejection's own message is the bare string
// `fetch failed`; what says whether this was DNS, a refused connection or a timeout lives one level
// down. Reporting the top line alone would exit non-zero with nothing a reader can act on, which is
// half of what joshuafolkken/kit#1564 set out to fix. Redaction runs over the joined text, so the
// deeper line is covered exactly as the top one is.
function join_cause(error: Error): string {
	const { cause } = error

	if (!(cause instanceof Error) || cause.message.length === 0) return error.message

	return `${error.message}: ${cause.message}`
}

// A non-`Error` throw is stated rather than stringified: `String({})` is `[object Object]`, which
// tells a reader nothing and is what `typescript:S6551` flags.
function describe_non_error(error: unknown): string {
	return typeof error === 'string' ? error : UNKNOWN_ERROR_TEXT
}

function describe_error(error: unknown): string {
	if (error instanceof Error) return join_cause(error)

	return describe_non_error(error)
}

// **The message alone, for an error this module built itself.** What `send` throws already carries
// the joined cause inside its own message, and its `cause` is a redacted copy of that same text — so
// walking the chain again here printed the whole reason twice on one line.
function describe_symptom(error: unknown): string {
	return error instanceof Error ? error.message : describe_non_error(error)
}

// The request URL carries the bot token in its own path, so an error raised anywhere near the
// request can carry a credential into a log. Both values are taken out of the text before it leaves
// this module, so no caller has to remember to do it (joshuafolkken/kit#1564).
function redact_credentials(text: string, config: TelegramConfig): string {
	return text.split(config.bot_token).join(REDACTED).split(config.chat_id).join(REDACTED)
}

// **Missing credentials are a failure, not a skip** (joshuafolkken/kit#1564). This used to warn and
// return `undefined`, and `send` then returned quietly — so a run with no credentials was
// indistinguishable from one whose notification arrived. Until this Issue the mandatory
// `--env-file=.env` flag on `josh notify` and `josh followup` made a machine without that file die
// before node started, which was loud by accident; with the flag relaxed to the optional form, this
// is where the noise has to come from instead.
//
// The message names the variables and never their values — the schema's own messages are the
// variable names, so nothing read out of the environment reaches it.
function load_config(): TelegramConfig {
	const result = telegram_environment_schema.safeParse({
		telegram_bot_token: parse_environment_string(process.env['TELEGRAM_BOT_TOKEN']),
		telegram_chat_id: parse_environment_string(process.env['TELEGRAM_CHAT_ID']),
	})

	if (!result.success) {
		const error_list = result.error.issues.map((issue) => issue.message).join(', ')

		throw new Error(`${NOT_CONFIGURED_PREFIX}: ${error_list}`)
	}

	return { bot_token: result.data.telegram_bot_token, chat_id: result.data.telegram_chat_id }
}

function build_header(task_type: TelegramTaskType, repo_name: string | undefined): string {
	const { icon, label } = TASK_DEFINITIONS[task_type]
	if (repo_name === undefined || repo_name.length === 0) return `${icon} ${label}`

	return `${icon} ${repo_name}: ${label}`
}

function push_if_present(target: Array<string>, value: string | undefined): void {
	if (value !== undefined && value.length > 0) target.push(value)
}

function build_title_block(input: TelegramSendInput): string {
	const lines: Array<string> = [build_header(input.task_type, input.repo_name)]

	push_if_present(lines, input.issue_title)

	return lines.join('\n')
}

function append_url(parts: Array<string>, label: string, value: string | undefined): void {
	if (value !== undefined && value.length > 0) parts.push(`${label}: ${value}`)
}

function build_url_parts(input: TelegramSendInput): Array<string> {
	const parts: Array<string> = []

	append_url(parts, 'Issue', input.issue_url)
	append_url(parts, 'PR', input.pr_url)

	return parts
}

function build_blocks(input: TelegramSendInput): Array<string> {
	const blocks: Array<string> = [build_title_block(input)]

	push_if_present(blocks, input.body)
	blocks.push(...build_url_parts(input))

	return blocks
}

function build_text(input: TelegramSendInput): string {
	return build_blocks(input).join('\n\n')
}

async function post_message(config: TelegramConfig, text: string): Promise<void> {
	const url = `${TELEGRAM_API_BASE}/bot${config.bot_token}/sendMessage`
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ chat_id: config.chat_id, text }),
	})

	if (!response.ok) {
		throw new Error(`Telegram API error: ${String(response.status)} ${response.statusText}`)
	}
}

// **The cause is re-wrapped rather than passed through** (joshuafolkken/kit#1564). The chain is kept,
// because a symptom error that drops its cause loses where the failure came from — but the original
// is the one object on this path nothing has redacted, and `git_error.handle` prints a cause's own
// message straight to the console. Both layers therefore carry the same already-redacted text.
function build_send_failure(error: unknown, config: TelegramConfig): Error {
	const reason = redact_credentials(describe_error(error), config)

	return new Error(`${SEND_FAILED_PREFIX}: ${reason}`, { cause: new Error(reason) })
}

// **The strict form.** A caller whose whole job is the notification has nothing left to report when
// this fails, so it throws and `pnpm josh notify` exits non-zero. joshuafolkken/kit#1564 measured
// the state this replaces: three notifications lost to a `504 Gateway Time-out`, each one printing a
// warning and exiting 0, so a message that reached nobody looked exactly like one that arrived.
//
// The failure it throws carries a `cause`, and that cause is redacted too — see `build_send_failure`.
async function send(input: TelegramSendInput): Promise<void> {
	const config = load_config()
	const text = build_text(input)

	try {
		await post_message(config, text)
	} catch (error) {
		throw build_send_failure(error, config)
	}

	console.info('📱 Telegram notification sent.')
}

// **The tolerant form**, for a caller whose job is something other than the notification.
// `followup` sends the completion message on its way to the merge, and a gateway timeout at
// Telegram is not a reason to leave a reviewed, green pull request unmerged — joshuafolkken/kit#1564
// measured exactly that 504 with six lanes running at once. So the failure is reported and the run
// carries on.
//
// **Reported under `❗` on stderr, in its own block, with the caller's own recovery line** — the bar
// joshuafolkken/kit#1539 set for a step that failed and was not allowed to end the run. The `⚠️`
// this used to print is what every routine notice prints, which is how the failure got buried.
//
// `recovery` is the caller's because only the caller knows one. It is `string | undefined` and not
// optional for the reason `CleanupStep.recovery` is: a caller with no command that finishes the job
// has to say so rather than leave the field off, and naming a command that would not work sends the
// reader somewhere useless.
//
// **Not routed through `git_followup_cleanup`**, which is that Issue's mechanism: it guards the
// steps a merge has already earned and says "failed after the merge" in its own wording, while this
// send happens *before* the merge. Borrowing it would print a sentence that is not true.
function report_send_failure(error: unknown, recovery: string | undefined): void {
	console.error('')
	console.error(`❗ ${describe_symptom(error)}`)
	console.error('   Nobody was notified, and the run carried on.')

	if (recovery !== undefined) console.error(`   Recovery: ${recovery}`)

	console.error('')
}

async function send_or_report(
	input: TelegramSendInput,
	recovery: string | undefined,
): Promise<boolean> {
	try {
		await send(input)

		return true
	} catch (error) {
		report_send_failure(error, recovery)

		return false
	}
}

const telegram_notify = {
	send,
	send_or_report,
}

export { telegram_notify, build_text, TASK_DEFINITIONS, telegram_environment_schema }
export type { TelegramSendInput, TelegramTaskType }
