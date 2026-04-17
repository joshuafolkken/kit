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
const GITHUB_ISSUE_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/u

function parse_task_type(raw: string | undefined): TelegramTaskType {
	if (raw === undefined) return DEFAULT_TASK_TYPE

	const matched = VALID_TASK_TYPES.find((candidate) => candidate === raw)

	if (matched === undefined) {
		throw new Error(`Invalid --task-type: ${raw}. Expected one of ${VALID_TASK_TYPES.join(', ')}.`)
	}

	return matched
}

function parse_issue_number(issue_url: string | undefined): string | undefined {
	if (issue_url === undefined) return undefined
	const match = GITHUB_ISSUE_URL_PATTERN.exec(issue_url)

	return match?.[1]
}

function coalesce(primary: string | undefined, fallback: string | undefined): string | undefined {
	if (primary !== undefined && primary.length > 0) return primary

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
	parse_issue_number,
}

export { telegram_test_logic }
export type { CliValues, ResolvedContext }
