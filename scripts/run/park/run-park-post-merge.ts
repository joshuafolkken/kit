import { issue_post_merge_check } from '#scripts/issue/issue-post-merge-check'
import { issue_read_cli } from '#scripts/issue/issue-read-cli'
import { session_cite } from '#scripts/issue/session-cite'
import { run_park_body } from './run-park-body'

// joshuafolkken/kit#8503: an issue that declares the `post_merge_check` key deferred its look past
// the merge, so a person's visual check is no stop for it. `run:park` refuses a park whose option
// needs that check (a permission line naming the visual check) on such an issue and prints the `/verify-ui` branch
// that records the look as unchecked and continues. Any other park, or a park on an issue without the
// declaration, goes through as before.

const VISUAL_WORD = '目視'
const VERIFY_UI_BRANCH =
	'.claude/skills/verify-ui/SKILL.md → "When there is no screenshot command" (the post_merge_check branch)'

function is_visual(park_body: string): boolean {
	return run_park_body
		.permissions_of(park_body)
		.some((permission) => permission?.includes(VISUAL_WORD) === true)
}

// The refusal for a visual-check park on an issue whose body declares a post-merge check;
// `undefined` when either is missing.
function refusal_of(issue_body: string, park_body: string): string | undefined {
	if (!is_visual(park_body)) return undefined
	const place = issue_post_merge_check.read(issue_body)

	if (place === undefined) return undefined

	return [
		`Park refused: the issue declares a post-merge check (${place}), so a visual check does not stop the run.`,
		'Check what you can without a screenshot, record `behavior checked, look unchecked` and where to look',
		`in the PR body and on the issue, and continue the run: ${VERIFY_UI_BRANCH}.`,
	].join('\n')
}

// The declaration lets a run skip a stop, so only a trusted body counts; a failed read parks as before.
async function trusted_body(issue_number: string): Promise<string | undefined> {
	const content = await issue_read_cli.read_block(issue_number)

	if (content.kind !== 'ok' || content.trust.is_body_trusted !== true) return undefined

	return content.body
}

// Whether `run:park` refuses this park, printing the refusal; reads the issue only for a visual park.
async function is_refused(issue_number: string, park_body: string): Promise<boolean> {
	if (!is_visual(park_body)) return false
	const issue_body = await trusted_body(issue_number)
	const refusal = issue_body === undefined ? undefined : refusal_of(issue_body, park_body)

	if (refusal === undefined) return false

	console.error(`${session_cite.issue(issue_number)}: ${refusal}`)

	return true
}

const run_park_post_merge = { is_refused, refusal_of }

export { run_park_post_merge }
