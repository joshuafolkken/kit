import { git_gh_exec, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import { gh_failure } from '#scripts/gh/git-gh-failure'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { backlog_measure_completeness } from './backlog-measure-completeness'
import { backlog_measure_schema, type MeasureBoundary } from './backlog-measure-schema'

const response_schema = z.object({ message: z.string() })
const SAFE_REASONS = new Set(['Bad credentials', 'Not Found', 'Forbidden', 'Validation Failed'])
const RATE_LIMIT = 'API rate limit exceeded'

function response_message(error: unknown): string {
	const response = json_value.parse_with(gh_failure.body_of(error) ?? '', response_schema)

	return response?.message ?? ''
}

function response_reason(error: unknown): string {
	const message = response_message(error)
	if (SAFE_REASONS.has(message)) return message
	if (message.startsWith(RATE_LIMIT)) return RATE_LIMIT

	if (message.startsWith('You have exceeded a secondary rate limit')) {
		return 'Secondary rate limit exceeded'
	}

	return 'unreported'
}

function failure(
	error: unknown,
): Pick<MeasureBoundary, 'failure' | 'http_status' | 'response_reason'> {
	const status = gh_failure.failure_of(error)?.status
	const reason = response_reason(error)

	return status === undefined
		? { failure: 'unreported', response_reason: reason }
		: { failure: 'http', http_status: status, response_reason: reason }
}

function failure_record(error: unknown, endpoint_index: number): MeasureBoundary {
	return {
		attempt: '',
		source: 'live',
		operation: 'gh.api',
		read_status: 'failed',
		...failure(error),
		endpoint_index,
	}
}

function install_http(
	records: Array<MeasureBoundary>,
	endpoints: ReadonlyArray<string> = [],
): () => void {
	const original = git_gh_exec.exec_gh_api

	git_gh_exec.exec_gh_api = async function observed(request: GhApiRequest): Promise<string> {
		try {
			return await original(request)
		} catch (error) {
			records.push(failure_record(error, endpoints.indexOf(request.path)))
			throw gh_failure.attach(new Error('Measurement API request failed'), {
				status: gh_failure.failure_of(error)?.status,
			})
		}
	}

	return function restore(): void {
		git_gh_exec.exec_gh_api = original
	}
}

function install_one(
	owner: object,
	operation: string,
	records: Array<MeasureBoundary>,
): () => void {
	const method = operation.slice(operation.indexOf('.') + 1)
	const original: unknown = Reflect.get(owner, method)

	const is_allowed = backlog_measure_schema.read_schema.shape.method.safeParse(operation).success

	if (!is_allowed || typeof original !== 'function') {
		return function noop(): void {
			Reflect.set(owner, method, original)
		}
	}

	Reflect.set(owner, method, async function observed(...args: Array<unknown>): Promise<unknown> {
		const value: unknown = await Reflect.apply(original, owner, args)
		const read_status = backlog_measure_completeness.observe(value, operation)

		if (read_status !== undefined) {
			records.push({ attempt: '', source: 'observation', operation, read_status })
		}

		return value
	})

	return function restore(): void {
		Reflect.set(owner, method, original)
	}
}

function install_reads(
	targets: ReadonlyMap<string, object>,
	records: Array<MeasureBoundary>,
): () => void {
	const restores = [...targets].flatMap(([name, owner]) =>
		Object.keys(owner).map((method) => install_one(owner, `${name}.${method}`, records)),
	)

	return function restore(): void {
		for (const undo of restores) undo()
	}
}

const backlog_measure_observe = { install_http, install_reads, failure }
export { backlog_measure_observe }
