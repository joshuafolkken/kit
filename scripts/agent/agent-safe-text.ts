// The text an agent launch may carry: a model id, an effort and a prompt, refused when empty, over
// length or carrying a control character, so nothing a value holds can inject a further argument.

const FIRST_PRINTABLE_CODE = 0x20
const DELETE_CODE = 0x7f
const FIRST_CODE_POINT = 0
const EMPTY_LENGTH = 0
const MAX_VALUE_LENGTH = 4096
// A prompt is prose that grows with its instructions, so it gets a cap of its own rather than a
// value's: an overrun investigation's prompt grew past 4096 and its launch was refused
// (joshuafolkken/kit#4930). 64 Ki UTF-16 units of mostly ASCII text stay under Linux's 128 KiB
// `MAX_ARG_STRLEN` per element; a launch the system still refuses fails as a noted launch failure.
const MAX_PROMPT_LENGTH = 65_536
const LINE_FEED = '\n'
const SPACE = ' '

function is_control_character(character: string): boolean {
	const code = character.codePointAt(FIRST_CODE_POINT) ?? FIRST_PRINTABLE_CODE

	return code < FIRST_PRINTABLE_CODE || code === DELETE_CODE
}

function is_line_feed(character: string): boolean {
	return character === LINE_FEED
}

function is_never_allowed(): boolean {
	return false
}

function is_refused(character: string, is_allowed: (character: string) => boolean): boolean {
	return is_control_character(character) && !is_allowed(character)
}

function is_safe_text(
	value: string,
	is_allowed: (character: string) => boolean,
	max_length: number,
): boolean {
	if (value.length === EMPTY_LENGTH || value.length > max_length) return false

	for (const character of value) if (is_refused(character, is_allowed)) return false

	return true
}

function is_safe_value(value: string): boolean {
	return is_safe_text(value, is_never_allowed, MAX_VALUE_LENGTH)
}

// **An agent's prompt is the one value a line break belongs in.** A ship-stop prompt carries the failed
// output's lines (joshuafolkken/kit#3964); every other control character is refused as in any value.
function is_safe_prompt(value: string): boolean {
	return is_safe_text(value, is_line_feed, MAX_PROMPT_LENGTH)
}

function printable_character(character: string): string {
	return is_refused(character, is_line_feed) ? SPACE : character
}

// Command output made fit for a prompt: every control character but a line break becomes a space, so
// the text passes `is_safe_prompt` whatever the command printed.
function printable(text: string): string {
	return Array.from(text, printable_character).join('')
}

const agent_safe_text = {
	MAX_PROMPT_LENGTH,
	MAX_VALUE_LENGTH,
	is_safe_prompt,
	is_safe_value,
	printable,
}

export { agent_safe_text }
