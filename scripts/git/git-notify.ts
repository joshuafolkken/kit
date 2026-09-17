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

// The `\n` escape the inline `--notify-message` form needs is expanded by `cli_body` at the point the
// flag is read, not here (joshuafolkken/kit#1198). Expanding again would rewrite a literal backslash-n
// that `--notify-message-file` legitimately carries — a file already holds real newlines, so an
// escape sequence in one is the author's text rather than a quoting workaround.
//
// **Trimming moved up with it, and for the same reason.** This function used to read
// `raw.trim().replaceAll(…)` — trim first, expand second. Keeping the trim here after the expansion
// had moved reversed that order, so `--notify-message "…\n"` lost the newline its own escape had just
// produced. `trim` survives only as the emptiness test, where the whitespace is being counted rather
// than removed.
function resolve_notify_message(raw_message: string | undefined): string {
	if (raw_message === undefined || raw_message.trim().length === 0) return DEFAULT_NOTIFY_MESSAGE

	return raw_message
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

// **`notes` is what the run has to say about itself beyond the message it was handed**, and today
// that is the managed config-file report (joshuafolkken/kit#1592). It is a separate field rather than
// text folded into `message`, because the message is the person's own completion summary and the
// notes are the command's — folding them together would leave a caller unable to tell which half it
// wrote. **A run with nothing to note adds no line at all**, blank separator included, so the
// ordinary completion report is byte-for-byte what it was.
// Its own function so the builder below keeps one branch rather than two: the absent case and the
// empty case are the same answer, and both have to add nothing — the blank separator included.
function note_section(notes: ReadonlyArray<string> | undefined): Array<string> {
	if (notes === undefined || notes.length === 0) return []

	return ['', ...notes]
}

function build_completion_comment_body(input: {
	message: string
	issue_number: string | undefined
	pr_url: string | undefined
	mentions: Array<string>
	notes?: ReadonlyArray<string>
}): string {
	const base_lines = [`✅ ${input.message}`]
	const issue_lines = input.issue_number === undefined ? [] : [`Issue: #${input.issue_number}`]
	const pr_lines = input.pr_url === undefined ? [] : [`PR: ${input.pr_url}`]
	const note_lines = note_section(input.notes)
	const mention_lines = input.mentions.length === 0 ? [] : ['', input.mentions.join(' ')]

	return [...base_lines, ...issue_lines, ...pr_lines, ...note_lines, ...mention_lines].join('\n')
}

const git_notify = {
	build_notify_config,
	build_completion_comment_body,
}

export type { GitNotifyConfig, NotifyTarget }
export { git_notify }
