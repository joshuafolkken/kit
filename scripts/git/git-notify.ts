type NotifyTarget = 'pr' | 'issue' | 'both'

interface GitNotifyConfig {
	target: NotifyTarget
	message: string
	mentions: Array<string>
}

const DEFAULT_NOTIFY_MESSAGE = 'Implementation is complete. Please review.'

function parse_notify_target(raw_target: string | undefined): NotifyTarget | undefined {
	if (raw_target === undefined) return undefined
	if (raw_target === 'pr') return 'pr'
	if (raw_target === 'issue') return 'issue'
	if (raw_target === 'both') return 'both'

	throw new Error(`Invalid notify target: ${raw_target}. Use pr, issue, or both.`)
}

function split_and_trim(value: string): Array<string> {
	return value
		.split(',')
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
}

function normalize_mention(mention: string): string {
	return mention.startsWith('@') ? mention : `@${mention}`
}

function parse_notify_mentions(raw_mentions: string | undefined): Array<string> {
	if (raw_mentions === undefined) return []

	return split_and_trim(raw_mentions).map((mention) => normalize_mention(mention))
}

function resolve_notify_message(raw_message: string | undefined): string {
	if (raw_message === undefined || raw_message.trim().length === 0) return DEFAULT_NOTIFY_MESSAGE

	return raw_message.trim().replaceAll(String.raw`\n`, '\n')
}

function build_notify_config(input: {
	raw_target: string | undefined
	raw_message: string | undefined
	raw_mentions: string | undefined
}): GitNotifyConfig | undefined {
	const parsed_target = parse_notify_target(input.raw_target)
	if (parsed_target === undefined) return undefined

	return {
		target: parsed_target,
		message: resolve_notify_message(input.raw_message),
		mentions: parse_notify_mentions(input.raw_mentions),
	}
}

function build_completion_comment_body(input: {
	message: string
	issue_number: string | undefined
	pr_url: string | undefined
	mentions: Array<string>
}): string {
	const base_lines = [`✅ ${input.message}`]
	const issue_lines = input.issue_number === undefined ? [] : [`Issue: #${input.issue_number}`]
	const pr_lines = input.pr_url === undefined ? [] : [`PR: ${input.pr_url}`]
	const mention_lines = input.mentions.length === 0 ? [] : ['', input.mentions.join(' ')]

	return [...base_lines, ...issue_lines, ...pr_lines, ...mention_lines].join('\n')
}

const git_notify = {
	build_notify_config,
	build_completion_comment_body,
}

export type { GitNotifyConfig, NotifyTarget }
export { git_notify }
