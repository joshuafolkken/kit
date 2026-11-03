import { behavior_change_lint } from './behavior-change-lint'
import { markdown_section } from './markdown-section'

// A behavior-change Issue adds a rule the model is asked to keep, and a prose-only rule is kept only by
// chance. So its background section names what stops a violation (the enforcement line) and the number
// that shows one (the measurement line). A missing line, an empty value or the none value is refused —
// measurement-only enforcement with no measurement is prose alone, and the measurement check refuses it.

const BACKGROUND_HEADING = '## 背景'
const ENFORCEMENT_PREFIX = '- 強制:'
const MEASUREMENT_PREFIX = '- 計測:'
const NONE_VALUE = 'なし'

// The value of the first background line starting with `prefix`, trimmed, or undefined when none does.
function declared_value(body: string, prefix: string): string | undefined {
	const line = markdown_section
		.section_lines(body, BACKGROUND_HEADING)
		.map((text) => text.trim())
		.find((text) => text.startsWith(prefix))

	return line?.slice(prefix.length).trim()
}

function declaration_problem(body: string, prefix: string, guide: string): string | undefined {
	const value = declared_value(body, prefix)

	if (value === undefined) {
		return `missing declaration under ${BACKGROUND_HEADING}: \`${prefix} ${guide}\``
	}

	if (value === '' || value === NONE_VALUE) {
		return `\`${prefix}\` must name ${guide}, not \`${value}\``
	}

	return undefined
}

// Every enforcement problem a body has, or an empty array. A body that does not declare itself a
// behavior-change Issue has none.
function problems(body: string): ReadonlyArray<string> {
	if (!behavior_change_lint.is_target(body)) return []

	return [
		declaration_problem(
			body,
			ENFORCEMENT_PREFIX,
			'<the hook, lint or gate that stops it> or 計測のみ',
		),
		declaration_problem(body, MEASUREMENT_PREFIX, '<the number a violation shows in (command)>'),
	].filter((problem): problem is string => problem !== undefined)
}

const enforcement_lint = { problems }

export { enforcement_lint }
