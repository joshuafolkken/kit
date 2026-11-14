import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { parse_json } from '#scripts/git/parse-json-array'
import { z } from 'zod'

const count_schema = z.object({
	total_count: z.number().int().nonnegative(),
	incomplete_results: z.literal(false),
})

// Only for a query that expresses the entire classification in its qualifiers. Body-based
// classification still needs the listing. Incomplete counts are unread, never a trusted rate.
async function count(query: string): Promise<number | undefined> {
	const parameters = new URLSearchParams({ q: query, per_page: '1' })

	try {
		const raw = await git_gh_exec.exec_gh_api({ path: `search/issues?${parameters.toString()}` })

		return parse_json.parse_json_object_or_undefined(raw, count_schema)?.total_count
	} catch {
		return undefined
	}
}

const issue_search_count = { count }

export { issue_search_count }
