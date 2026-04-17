import { SEPARATOR_LINE } from './constants'

function display_start_separator(): void {
	console.info('')
	console.info(SEPARATOR_LINE)
}

function display_end_separator(): void {
	console.info(SEPARATOR_LINE)
}

function display_invalid_answer_message(): void {
	console.info('💡 Reply y / n.')
}

const git_prompt_display = {
	display_start_separator,
	display_end_separator,
	display_invalid_answer_message,
}

export { git_prompt_display }
