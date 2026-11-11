import { behavior_change_lint } from './behavior-change-lint'
import { issue_body_keys } from './issue-body-keys'
import { measure_declaration } from './measure-declaration'

// A behavior-change Issue adds a rule the model is asked to keep, and a prose-only rule is kept only by
// chance. So its background section names what stops a violation (the enforcement line) and the number
// that shows one (the measurement line). A missing line, an empty value, the none value or an unfilled
// template placeholder is refused — measurement-only enforcement with no measurement is prose alone,
// and the measurement check refuses it. A line inside a fenced example is not a declaration.

const ENFORCEMENT_PREFIX = issue_body_keys.prefix('enforcement')
const MEASUREMENT_PREFIX = issue_body_keys.prefix('measurement')
const BACKGROUND_HEADING = issue_body_keys.heading('background')
const NONE_VALUE = issue_body_keys.value('none')
const PLACEHOLDER_PREFIX = '<'

function is_unnamed(value: string): boolean {
	return value === '' || value === NONE_VALUE || value.startsWith(PLACEHOLDER_PREFIX)
}

function declaration_problem(body: string, prefix: string, guide: string): string | undefined {
	const value = measure_declaration.background_value(body, prefix)

	if (value === undefined) {
		return `missing declaration under ${BACKGROUND_HEADING}:\`${prefix} ${guide}\``
	}

	return is_unnamed(value) ? `\`${prefix}\` must name ${guide}, not \`${value}\`` : undefined
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
