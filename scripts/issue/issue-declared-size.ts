import { git_gh_command } from '#scripts/gh/git-gh-command'
import type { DeclaredSize } from '#scripts/split/split-assess'
import { size_estimate } from './size-estimate'

// An Issue's declared size estimate (`size_estimate.declared_size`), read from its body: what the split notice's bar
// grows from (`split-resolution.ts`) and what `lane:stats` calibrates against (`lane-size-record.ts`).
// A body with no estimate is `undefined`; a read that failed (missing, rate-limited, unreachable)
// throws, so a caller that keeps the answer never keeps a passing failure as "no declaration".
async function read(issue: string): Promise<DeclaredSize | undefined> {
	const body = await git_gh_command.issue_get_body_classified(issue)

	if (body.kind !== 'read') throw new Error(`issue ${issue} body: ${body.kind}`)
	if (body.text === undefined) return undefined
	const estimate = size_estimate.declared_size(body.text)

	return estimate === undefined ? undefined : { files: estimate.files, lines: estimate.lines }
}

const issue_declared_size = { read }

export { issue_declared_size }
