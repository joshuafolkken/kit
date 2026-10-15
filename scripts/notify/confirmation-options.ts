import { session_language } from '#scripts/josh/session-language'

// **A confirmation names what to choose, not only why the run stopped.** The person reading it is
// off-screen by definition, so the message itself carries the recommended choice and the others —
// in the session language, because that is the language the person works in.

interface ConfirmationOptions {
	recommended: string
	alternatives: ReadonlyArray<string>
}

interface Headings {
	recommended: string
	alternatives: string
	none: string
}

const JAPANESE_LANG_PREFIX = 'ja'
const JAPANESE_HEADINGS: Headings = {
	recommended: '推奨:',
	alternatives: '他の選択肢:',
	none: 'なし',
}
const ENGLISH_HEADINGS: Headings = {
	recommended: 'Recommended:',
	alternatives: 'Alternatives:',
	none: 'none',
}

// Only the two languages the workflow is written in have headings; any other falls back to English.
function headings(): Headings {
	const { lang } = session_language.resolve_session_lang()

	return lang.toLowerCase().startsWith(JAPANESE_LANG_PREFIX) ? JAPANESE_HEADINGS : ENGLISH_HEADINGS
}

// An empty list is stated as none, so a confirmation with no other option says so rather than
// leaving a reader to wonder whether the line was lost.
function alternatives_block(options: ConfirmationOptions, labels: Headings): string {
	if (options.alternatives.length === 0) return `${labels.alternatives} ${labels.none}`

	const lines = options.alternatives.map((alternative) => `- ${alternative}`)

	return [labels.alternatives, ...lines].join('\n')
}

// The block is handed to the sender as its own `choices` field rather than appended to the body:
// the body is what a too-long message is cut from, and the choices are the one part a reader cannot
// act without, so they must survive the cut.
function block(options: ConfirmationOptions): string {
	const labels = headings()

	return `${labels.recommended} ${options.recommended}\n${alternatives_block(options, labels)}`
}

const confirmation_options = { block }

export { confirmation_options }
export type { ConfirmationOptions }
