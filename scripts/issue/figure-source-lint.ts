import { markdown_section } from './markdown-section'

// joshuafolkken/kit#7021: a number a decision rests on names the command that measured it, or says it is
// a prediction. A line under the background or expected-effect heading that holds a figure but neither
// a backticked command nor the prediction word is warned about — never refused, since a figure is not
// always a decision.

const BACKGROUND_HEADING = '## 背景'
const EFFECT_HEADING = '## 期待効果'
const PREDICTION = '予測'
// A backticked command: a code span with an argument, so a bare name such as a file path is no source.
const COMMAND = /`[^`\s]+\s[^`]*`/u
const WARNING = `number with no source (add the command that measured it in backticks, or write ${PREDICTION}): `
// Numbers that are not figures: issue and pull request references, dates and an ordered-list marker.
const NOT_A_FIGURE = /#\d+|\d{4}-\d{2}-\d{2}|^\d+\.\s/gu
const DIGIT = /\d/u
// The background declarations whose figure the template already sources or marks an estimate
// (`issue-template.md`'s declaration table); any other keyed bullet is read as prose.
const DECLARATIONS = [
	'- 規模見積もり:',
	'- 原因のレーン:',
	'- 原因の損失:',
	'- 優先度:',
	'- 実施可能条件:',
]

function text_lines(body: string, heading: string): ReadonlyArray<string> {
	const section = markdown_section.section_lines(body, heading).join('\n')

	return markdown_section.unfenced_lines(section).map((line) => line.trim())
}

function has_no_source(line: string): boolean {
	if (COMMAND.test(line) || line.includes(PREDICTION)) return false

	return DIGIT.test(line.replaceAll(NOT_A_FIGURE, ''))
}

// One warning per figure line with no source, background lines first.
function warnings(body: string): ReadonlyArray<string> {
	const background = text_lines(body, BACKGROUND_HEADING).filter((line) =>
		DECLARATIONS.every((prefix) => !line.startsWith(prefix)),
	)

	return [...background, ...text_lines(body, EFFECT_HEADING)]
		.filter((line) => has_no_source(line))
		.map((line) => `${WARNING}${line}`)
}

const figure_source_lint = { warnings }

export { figure_source_lint }
