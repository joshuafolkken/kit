import { cli_body } from '#scripts/josh/cli-body'
import { confirmation_options } from './confirmation-options'
import type { TelegramSendInput, TelegramTaskType } from './telegram-notify'

/* eslint-disable @typescript-eslint/naming-convention */
interface CliValues {
	'task-type'?: string
	'repo-name'?: string
	'issue-title'?: string
	body?: string
	'body-file'?: string
	'issue-url'?: string
	'pr-url'?: string
	recommended?: string
	alternative?: Array<string>
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
	'warning',
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
// two could disagree about an empty string and leave the field blank.
// It is `cli_body`'s predicate rather than a second copy: the body flags are resolved there, and two
// definitions of "given" would let `--body ''` count on one side and not the other.
const has_flag_value = cli_body.has_value

function coalesce(primary: string | undefined, fallback: string | undefined): string | undefined {
	if (has_flag_value(primary)) return primary

	return fallback
}

// `--body-file` is the form to reach for whenever the body carries a backtick or a `$`: inside shell
// double quotes those are evaluated before this process starts, and the text runs.
// The resolution itself is `cli_body`'s, shared with `josh followup`.
function normalize_body(values: CliValues): string | undefined {
	return cli_body.resolve({
		inline: values.body,
		file_path: values['body-file'],
		inline_flag: '--body',
		file_flag: '--body-file',
	})
}

// **A confirmation without a recommended choice is refused, not sent**: the person it reaches is
// off-screen, and a stop that names no choice leaves them to reconstruct one. `--alternative` may be
// absent — a stop with one way forward says so — so only `--recommended` is required.
function require_recommended(values: CliValues): string {
	const recommended = values.recommended?.trim() ?? ''

	if (recommended.length === 0) {
		throw new Error('--task-type confirmation needs --recommended "<the recommended choice>".')
	}

	return recommended
}

function given_alternatives(values: CliValues): Array<string> {
	return (values.alternative ?? []).filter((alternative) => alternative.trim().length > 0)
}

function build_choices(values: CliValues, task_type: TelegramTaskType): string | undefined {
	if (task_type !== 'confirmation') return undefined

	return confirmation_options.block({
		recommended: require_recommended(values),
		alternatives: given_alternatives(values),
	})
}

function build_input(input: { values: CliValues; context: ResolvedContext }): TelegramSendInput {
	const task_type = parse_task_type(input.values['task-type'])

	return {
		task_type,
		repo_name: coalesce(input.values['repo-name'], input.context.repo_name),
		issue_title: coalesce(input.values['issue-title'], input.context.issue_title),
		body: normalize_body(input.values),
		choices: build_choices(input.values, task_type),
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
