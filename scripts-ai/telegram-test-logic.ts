import type { TelegramSendInput, TelegramTaskType } from '../scripts/git/telegram-notify'

/* eslint-disable @typescript-eslint/naming-convention */
interface CliValues {
	'task-type'?: string
	'repo-name'?: string
	'issue-title'?: string
	body?: string
	'issue-url'?: string
	'pr-url'?: string
}
/* eslint-enable @typescript-eslint/naming-convention */

interface ResolvedContext {
	repo_name: string | undefined
	issue_title: string | undefined
}

const VALID_TASK_TYPES: ReadonlyArray<TelegramTaskType> = [
	'planning',
	'completion',
	'failure',
	'kickoff_retry',
	'confirmation',
]

const DEFAULT_TASK_TYPE: TelegramTaskType = 'planning'

function parse_task_type(raw: string | undefined): TelegramTaskType {
	if (raw === undefined) return DEFAULT_TASK_TYPE

	const matched = VALID_TASK_TYPES.find((candidate) => candidate === raw)

	if (matched === undefined) {
		throw new Error(`Invalid --task-type: ${raw}. Expected one of ${VALID_TASK_TYPES.join(', ')}.`)
	}

	return matched
}

// A flag counts as given only when it carries text, so `--issue-title ''` is not an answer. The
// callers that *skip* a lookup because the flag already answered it read the same predicate, or the
// two could disagree about an empty string and leave the field blank (joshuafolkken/kit#903).
function has_flag_value(raw: string | undefined): boolean {
	return raw !== undefined && raw.length > 0
}

function coalesce(primary: string | undefined, fallback: string | undefined): string | undefined {
	if (has_flag_value(primary)) return primary

	return fallback
}

function normalize_body(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined

	return raw.replaceAll(String.raw`\n`, '\n')
}

function build_input(input: { values: CliValues; context: ResolvedContext }): TelegramSendInput {
	return {
		task_type: parse_task_type(input.values['task-type']),
		repo_name: coalesce(input.values['repo-name'], input.context.repo_name),
		issue_title: coalesce(input.values['issue-title'], input.context.issue_title),
		body: normalize_body(input.values.body),
		issue_url: input.values['issue-url'],
		pr_url: input.values['pr-url'],
	}
}

const telegram_test_logic = {
	build_input,
	parse_task_type,
	has_flag_value,
}

export { telegram_test_logic }
export type { CliValues, ResolvedContext }
