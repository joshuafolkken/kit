const TELEGRAM_API_BASE = 'https://api.telegram.org'

type TelegramTaskType = 'planning' | 'completion' | 'failure' | 'kickoff_retry' | 'confirmation'

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
	kickoff_retry: { icon: '🔄', label: 'Kickoff retry' },
	confirmation: { icon: '⏸️', label: 'Confirmation required' },
}

function get_environment(name: string): string | undefined {
	return process.env[name]
}

function load_config(): TelegramConfig | undefined {
	const bot_token = get_environment('TELEGRAM_BOT_TOKEN')?.trim()
	const chat_id = get_environment('TELEGRAM_CHAT_ID')?.trim()

	if (!bot_token || !chat_id) return undefined

	return { bot_token, chat_id }
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

const SKIP_WARNING =
	'⚠️  Telegram not configured: TELEGRAM_BOT_TOKEN and/or TELEGRAM_CHAT_ID not set. Skipping.'

async function send(input: TelegramSendInput): Promise<void> {
	const config = load_config()

	if (config === undefined) {
		console.warn(SKIP_WARNING)

		return
	}

	const text = build_text(input)

	try {
		await post_message(config, text)
		console.info('📱 Telegram notification sent.')
	} catch (error) {
		console.warn(
			'⚠️  Telegram notification failed:',
			error instanceof Error ? error.message : error,
		)
	}
}

const telegram_notify = {
	send,
}

export { telegram_notify, build_text, TASK_DEFINITIONS }
export type { TelegramSendInput, TelegramTaskType }
