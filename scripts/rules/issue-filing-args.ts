const SHELL_WORD = /(?:[^\s'"]|'[^']*'|"[^"]*")+/gu
const QUOTE = /['"]/gu
const RAW_FIELDS = new Set(['-f', '--raw-field'])
const FILE_FIELDS = new Set(['-F', '--field'])
const LABEL_OPTIONS = new Set(['-l', '--label'])
const BODY_FILE_OPTIONS = new Set(['--body-file'])
const INLINE_BODY_OPTIONS = new Set(['-b', '--body'])
const BODY_FILE_PREFIX = 'body=@'

function words_of(command: string): Array<string> {
	return [...command.matchAll(SHELL_WORD)].map((match) => match[0].replaceAll(QUOTE, ''))
}

function values_after(words: ReadonlyArray<string>, flags: ReadonlySet<string>): Array<string> {
	return words.flatMap((word, index) => {
		const value = words[index + 1]

		return value !== undefined && flags.has(word) ? [value] : []
	})
}

function has_inline_body(words: ReadonlyArray<string>): boolean {
	const has_raw = values_after(words, RAW_FIELDS).some((value) => value.startsWith('body='))

	return has_raw || values_after(words, INLINE_BODY_OPTIONS).length > 0
}

function body_file(command: string): string | undefined {
	const words = words_of(command)
	const fields = values_after(words, FILE_FIELDS).filter((value) => value.startsWith('body='))
	const options = values_after(words, BODY_FILE_OPTIONS)

	if (has_inline_body(words) || fields.length + options.length !== 1) return undefined

	return fields[0]?.startsWith(BODY_FILE_PREFIX)
		? fields[0].slice(BODY_FILE_PREFIX.length)
		: options[0]
}

function has_label(command: string, label: string): boolean {
	const words = words_of(command)
	const fields = [...values_after(words, RAW_FIELDS), ...values_after(words, FILE_FIELDS)]
	const options = values_after(words, LABEL_OPTIONS).flatMap((value) => value.split(','))

	return fields.includes(`labels[]=${label}`) || options.includes(label)
}

const issue_filing_args = { body_file, has_label, words_of }

export { issue_filing_args }
