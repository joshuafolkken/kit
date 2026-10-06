import { open_issue_schema } from '#scripts/git/git-schemas'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_list } from './git-gh-issue-list'
import {
	BLOCKED_BY_SEGMENT,
	ISSUE_NUMBER,
	rest_blockers,
	rest_dependencies_summary,
	rest_issue_page,
} from './git-gh-issue-rest-fixture'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const PICKUP_FIELDS = 'number,title,labels,createdAt,blockedBy'
const SECOND_NUMBER = 900
const LIMIT_ONE = 1
const LIMIT_MANY = 50
const SLOW_READ_MS = 20
const BOTH_ROWS = 2

interface Flight {
	current: number
	peak: number
}

// joshuafolkken/kit#3103: the relations are read concurrently, so the first request to start is not
// the first to finish. The first row's read is held back so it lands last, and `flight` records how
// many relation reads were in progress at once.
function serve_blockers_out_of_order(): Flight {
	const flight: Flight = { current: 0, peak: 0 }

	mocked_api.mockImplementation(async (request) => {
		if (!request.path.includes(BLOCKED_BY_SEGMENT)) {
			return rest_issue_page([
				{ number: ISSUE_NUMBER, ...rest_dependencies_summary(LIMIT_ONE) },
				{ number: SECOND_NUMBER, ...rest_dependencies_summary(LIMIT_ONE) },
			])
		}

		const is_first = request.path.includes(`/${String(ISSUE_NUMBER)}/`)

		flight.current += 1
		flight.peak = Math.max(flight.peak, flight.current)
		await new Promise((resolve) => setTimeout(resolve, is_first ? SLOW_READ_MS : 0))
		flight.current -= 1

		return rest_blockers(is_first ? 'closed' : 'open')
	})

	return flight
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('issue_list — concurrent blocker relations', () => {
	it('keeps each row paired with its own blockers when the reads finish out of order', async () => {
		serve_blockers_out_of_order()

		const outcome = await git_gh_issue_list.issue_list({
			json_fields: PICKUP_FIELDS,
			limit: LIMIT_MANY,
		})
		const rows = parse_json_array_or_undefined(outcome.json ?? '', open_issue_schema)

		expect(rows?.map((row) => row.blockedBy?.nodes[0]?.state)).toEqual(['CLOSED', 'OPEN'])
	})

	it('starts the second read before the first one has finished', async () => {
		const flight = serve_blockers_out_of_order()

		await git_gh_issue_list.issue_list({ json_fields: PICKUP_FIELDS, limit: LIMIT_MANY })

		expect(flight.peak).toBe(BOTH_ROWS)
	})
})
