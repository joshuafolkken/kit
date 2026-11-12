import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { FULL_PAGE_QUERY, git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'

// The open code scanning alerts that sit in a pull request's own changed files — the red a merge of
// the default branch cannot clear, so `josh ship` stops on it rather than merging and gating again
// (joshuafolkken/kit#5381).
//
// **Any gap reads as none**: one alert with no location (it hides the whole listing), a listing that
// is not one, a token the endpoint answers 403 to — each answers `undefined`, and the caller merges
// again as it did before.

const ALERT_NOTE =
	'code scanning alerts in the pull request’s own files (a merge does not clear them):'

const location_schema = z.looseObject({ path: z.string(), start_line: z.number() })

const alert_schema = z.looseObject({
	rule: z.looseObject({ id: z.string() }),
	most_recent_instance: z.looseObject({ location: location_schema }),
})

const file_schema = z.looseObject({ filename: z.string() })

interface PullAlert {
	rule: string
	path: string
	line: number
}

async function read_listing<T>(path: string, schema: z.ZodType<T>): Promise<Array<T> | undefined> {
	const raw_json = await git_gh_exec.exec_gh_api({ path, should_paginate: true })

	return json_value.parse_with(raw_json, schema.array())
}

async function read_alerts(pr_number: number): Promise<Array<PullAlert> | undefined> {
	const query = `${FULL_PAGE_QUERY}&state=open&ref=refs/pull/${String(pr_number)}/merge`
	const path = `${git_gh_api_path.code_scanning_alerts_api_path()}${query}`
	const alerts = await read_listing(path, alert_schema)

	return alerts?.map(({ rule, most_recent_instance: { location } }) => ({
		rule: rule.id,
		path: location.path,
		line: location.start_line,
	}))
}

async function read_files(pr_number: number): Promise<Set<string> | undefined> {
	const path = `${git_gh_api_path.pull_files_api_path(String(pr_number))}${FULL_PAGE_QUERY}`
	const files = await read_listing(path, file_schema)

	return files === undefined ? undefined : new Set(files.map((file) => file.filename))
}

async function read_own_alerts(pr_number: number): Promise<Array<PullAlert> | undefined> {
	const [alerts, files] = await Promise.all([read_alerts(pr_number), read_files(pr_number)])
	if (alerts === undefined || files === undefined) return undefined

	return alerts.filter((alert) => files.has(alert.path))
}

// The stop note naming each alert's rule and `file:line`, or `undefined` when there is none to name.
async function own_alerts_note(pr_number: number): Promise<string | undefined> {
	try {
		const alerts = await read_own_alerts(pr_number)
		if (alerts === undefined || alerts.length === 0) return undefined

		return [
			ALERT_NOTE,
			...alerts.map((alert) => `  ${alert.rule} — ${alert.path}:${String(alert.line)}`),
		].join('\n')
	} catch {
		return undefined
	}
}

const git_gh_code_scanning = { ALERT_NOTE, own_alerts_note }

export { git_gh_code_scanning }
