import { gh_spawn } from '#scripts/gh/gh-spawn'
import { timed_fetch } from '#scripts/lib/timed-fetch'
import { z } from 'zod'

const TELEGRAM_API_BASE = 'https://api.telegram.org'
// `sendMessage` refuses a text longer than this.
const TELEGRAM_TEXT_LIMIT = 4096
const BODY_TRUNCATION_MARK = '\n...'
const TRAILING_HIGH_SURROGATE = /[\uD800-\uDBFF]$/u

const telegram_environment_schema = z.object({
	telegram_bot_token: z.string().min(1, { message: 'TELEGRAM_BOT_TOKEN is required' }),
	telegram_chat_id: z.string().min(1, { message: 'TELEGRAM_CHAT_ID is required' }),
})

// **`warning` is not `failure`**. It names a run that finished and merged,
// alongside something that did not work — a post-merge cleanup step that could not complete is one.
// Sending `failure` (❌) there would say the merge failed, which is false and is
// the more expensive lie of the two; sending `completion` (✅) twice says nothing went wrong, which
// is the silence this type exists to end.
// **`stalled` is not `warning`**. `warning` names a run that *finished* and
// merged alongside something that did not work; a stall is the opposite — the run is alive and has not
// finished, it has simply stopped advancing while ready work waits for a free lane. The ⏳ icon says
// exactly that: not done, not broken, just not moving.
// **`stranded` is not `stalled`**. A stall is a *live* run that is not
// dispatching; a strand is the step before it — the run's own driver is gone. The session that cut the
// budget handed it off and died, no successor claimed it, and no supervisor is watching, so nothing can
// take the next step at all. The 🚨 icon says a run needs a hand, not that ready work is merely waiting.
type TelegramTaskType =
	| 'planning'
	| 'completion'
	| 'failure'
	| 'warning'
	| 'kickoff_retry'
	| 'confirmation'
	| 'stalled'
	| 'stranded'
	| 'progress'

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
	stalled: { icon: '⏳', label: 'Ready work is sitting undispatched' },
	stranded: { icon: '🚨', label: 'Run stranded — nobody is driving it' },
	progress: { icon: '📊', label: 'Progress' },
}

const NOTIFY_SWITCH_KEY = 'JOSH_NOTIFY'
const NOTIFY_OFF_VALUE = 'off'
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
// down. Reporting the top line alone would exit non-zero with nothing a reader can act on.
// Redaction runs over the joined text, so the deeper line is covered exactly as the top one is.
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
// this module, so no caller has to remember to do it.
function redact_credentials(text: string, config: TelegramConfig): string {
	return text.split(config.bot_token).join(REDACTED).split(config.chat_id).join(REDACTED)
}

// **Missing credentials are a failure, not a skip**: a run with no credentials that returned quietly
// would be indistinguishable from one whose notification arrived. `josh notify` and `josh followup`
// load `.env` only optionally, so this is where the noise has to come from.
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

// **An explicit opt-out is not a missing credential**: a consumer who never means to use Telegram
// says so, rather than seeing the missing-credential failure on every stop. Only the stated value
// `off` disables the send: an unset or mistyped switch still falls through to `load_config`, so a
// forgotten setup stays a loud failure.
function is_notify_disabled(): boolean {
	return parse_environment_string(process.env[NOTIFY_SWITCH_KEY]).toLowerCase() === NOTIFY_OFF_VALUE
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

function join_blocks(input: TelegramSendInput): string {
	return build_blocks(input).join('\n\n')
}

// A cut between the two halves of a surrogate pair leaves a lone surrogate, which is not valid
// UTF-8 once encoded, so the half is dropped with the rest of the tail.
function head_of(body: string, kept: number): string {
	const head = body.slice(0, kept)

	return TRAILING_HIGH_SURROGATE.test(head) ? head.slice(0, -1) : head
}

// **The body is cut to fit Telegram's length limit, keeping its head**: a text past the limit is
// refused with `400 Bad Request` and reaches nobody. A caller puts the cause first, so the tail is
// what is dropped, and the header and the URLs around the body survive.
function build_text(input: TelegramSendInput): string {
	const text = join_blocks(input)
	const overflow = text.length - TELEGRAM_TEXT_LIMIT
	if (overflow <= 0 || input.body === undefined) return text
	const kept = Math.max(0, input.body.length - overflow - BODY_TRUNCATION_MARK.length)

	return join_blocks({ ...input, body: `${head_of(input.body, kept)}${BODY_TRUNCATION_MARK}` })
}

async function post_message(config: TelegramConfig, text: string): Promise<void> {
	const url = `${TELEGRAM_API_BASE}/bot${config.bot_token}/sendMessage`
	const response = await timed_fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ chat_id: config.chat_id, text }),
	})

	if (!response.ok) {
		throw new Error(`Telegram API error: ${String(response.status)} ${response.statusText}`)
	}
}

// **The cause is re-wrapped rather than passed through**. The chain is kept,
// because a symptom error that drops its cause loses where the failure came from — but the original
// is the one object on this path nothing has redacted, and `git_error.handle` prints a cause's own
// message straight to the console. Both layers therefore carry the same already-redacted text.
function build_send_failure(error: unknown, config: TelegramConfig): Error {
	const reason = redact_credentials(describe_error(error), config)

	return new Error(`${SEND_FAILED_PREFIX}: ${reason}`, { cause: new Error(reason) })
}

// **The strict form.** A caller whose whole job is the notification has nothing left to report when
// this fails, so it throws and `pnpm josh notify` exits non-zero — a warning and exit 0 would make a
// message that reached nobody look exactly like one that arrived.
//
// The failure it throws carries a `cause`, and that cause is redacted too — see `build_send_failure`.
//
// The opt-out is checked here, before `load_config`, so every caller — the tolerant form included —
// skips the same way and none has to repeat the check.
async function send(input: TelegramSendInput): Promise<void> {
	if (is_notify_disabled()) {
		console.info(
			`🔕 Telegram notifications are disabled (${NOTIFY_SWITCH_KEY}=${NOTIFY_OFF_VALUE}).`,
		)

		return
	}

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
// Telegram is not a reason to leave a reviewed, green pull request unmerged. So the failure is
// reported and the run carries on.
//
// **Reported under `❗` on stderr, in its own block, with the caller's own recovery line** — the bar
// for a step that failed and was not allowed to end the run. A `⚠️` is what every routine notice
// prints, so the failure would be buried under one.
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

// Long enough that a stalled `gh` never holds a warning back, short enough that the message still
// names the repository it is about.
const REPO_LOOKUP_TIMEOUT_MS = 5000

interface WarningInput {
	issue_title: string
	body: string
	recovery: string
}

/**
 * Warn that something an unattended run depended on did not work.
 *
 * **One function rather than one per caller**. Every warning fills in the
 * same four fields the same way — the task type, the repository looked up under the same bound, and
 * two urls that are never known here — so a second caller composing its own would be free to drift
 * on the one field that is not obvious: a repository lookup with no timeout hangs the warning behind
 * the failure it is reporting.
 */
async function warn(input: WarningInput): Promise<boolean> {
	return await send_or_report(
		{
			task_type: 'warning',
			repo_name: gh_spawn.get_repo_name_with_owner_within(REPO_LOOKUP_TIMEOUT_MS),
			issue_title: input.issue_title,
			body: input.body,
			issue_url: undefined,
			pr_url: undefined,
		},
		input.recovery,
	)
}

interface ConfirmInput {
	issue_title: string
	body: string
	recovery: string
}

/**
 * Push the ⏸️ confirmation type — a state change an unattended run made that a person now has to act
 * on, a `backlogrun` that stopped needing a decision being the one this was written for.
 *
 * **One function rather than one per caller, for `warn`'s reason exactly**: the repository lookup
 * under a timeout is the field a second caller composing the four itself would drift on, and a lookup
 * with no bound hangs the confirmation behind the very stop it is announcing. The tolerant `send_or_report`
 * is used, not the strict `send`: the run is ending either way, so a gateway timeout at Telegram must
 * not turn a stop into a crash — the pull path (`pnpm josh run:wake --list`) is the fallback the
 * `recovery` line names.
 */
async function confirm(input: ConfirmInput): Promise<boolean> {
	return await send_or_report(
		{
			task_type: 'confirmation',
			repo_name: gh_spawn.get_repo_name_with_owner_within(REPO_LOOKUP_TIMEOUT_MS),
			issue_title: input.issue_title,
			body: input.body,
			issue_url: undefined,
			pr_url: undefined,
		},
		input.recovery,
	)
}

interface StalledInput {
	body: string
	recovery: string
}

/**
 * Push the ⏳ stalled type — ready backlog work with a free lane that nothing has dispatched for a while.
 * Off-screen is the whole point: the state is invisible on the terminal until
 * a person asks, so it reaches them where they are not watching.
 *
 * **`warn`'s shape exactly** — the repository looked up under the shared bound, the tolerant
 * `send_or_report` so a gateway timeout at Telegram never fails the detector that is only reporting, and
 * the caller's own `recovery` line. No `issue_title`: the header label already names what this is, and
 * the body carries what is waiting, so a title line would only repeat the header.
 */
async function stalled(input: StalledInput): Promise<boolean> {
	return await send_or_report(
		{
			task_type: 'stalled',
			repo_name: gh_spawn.get_repo_name_with_owner_within(REPO_LOOKUP_TIMEOUT_MS),
			issue_title: undefined,
			body: input.body,
			issue_url: undefined,
			pr_url: undefined,
		},
		input.recovery,
	)
}

interface StrandedInput {
	body: string
	recovery: string
}

/**
 * Push the 🚨 stranded type — a run whose driver is gone and which nothing can advance.
 * Off-screen is the whole point, as it is for `stalled`: the state is
 * invisible on the terminal because the session that would show it has died, so the person hears about
 * it where they are not watching, rather than by asking.
 *
 * **`stalled`'s shape exactly** — the repository looked up under the shared bound, the tolerant
 * `send_or_report` so a Telegram timeout never fails the detector that is only reporting, and the
 * caller's own `recovery` line naming the command that hands the run to a fresh supervisor. No
 * `issue_title`: the header label already names what this is.
 */
async function stranded(input: StrandedInput): Promise<boolean> {
	return await send_or_report(
		{
			task_type: 'stranded',
			repo_name: gh_spawn.get_repo_name_with_owner_within(REPO_LOOKUP_TIMEOUT_MS),
			issue_title: undefined,
			body: input.body,
			issue_url: undefined,
			pr_url: undefined,
		},
		input.recovery,
	)
}

/**
 * Push the 📊 progress type — one `run:board` frame a person asked to receive periodically off-screen
 * with `run:board --every`. Never a heartbeat: nothing sends it unasked.
 *
 * **`stranded`'s shape exactly**, with the board's own one-frame answer as the recovery — a frame lost
 * to a Telegram timeout is read again by asking for it.
 */
async function progress(body: string): Promise<boolean> {
	return await send_or_report(
		{
			task_type: 'progress',
			repo_name: gh_spawn.get_repo_name_with_owner_within(REPO_LOOKUP_TIMEOUT_MS),
			issue_title: undefined,
			body,
			issue_url: undefined,
			pr_url: undefined,
		},
		'pnpm josh run:board --chat',
	)
}

const telegram_notify = {
	confirm,
	progress,
	send,
	send_or_report,
	stalled,
	stranded,
	warn,
}

export { telegram_notify, build_text, TASK_DEFINITIONS, telegram_environment_schema }
export type { TelegramSendInput, TelegramTaskType }
