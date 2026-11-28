import { git_gh_command } from '#scripts/gh/git-gh-command'
import type { DeclaredSize } from '#scripts/split/split-assess'
import { issue_body_adopt_branch } from './issue-body-adopt-branch'
import { size_estimate } from './size-estimate'

// An Issue's declared size estimate (`size_estimate.declared_size`), read from its body: what the split notice's bar
// grows from (`split-resolution.ts`) and what `lane:stats` calibrates against (`lane-size-record.ts`).
// A body with no estimate is `undefined`; a read that failed (missing, rate-limited, unreachable)
// throws, so a caller that keeps the answer never keeps a passing failure as "no declaration".
// `read_lane` adds whether the body adopts a finished branch — a theme lane `lane-pace.ts` leaves
// unjudged (joshuafolkken/kit#9164) — from the same single body read.

interface LaneDeclaration {
	declared: DeclaredSize | undefined
	is_adopted: boolean
}

function declared_of(text: string): DeclaredSize | undefined {
	const estimate = size_estimate.declared_size(text)

	return estimate === undefined ? undefined : { files: estimate.files, lines: estimate.lines }
}

async function read_lane(issue: string): Promise<LaneDeclaration> {
	const body = await git_gh_command.issue_get_body_classified(issue)

	if (body.kind !== 'read') throw new Error(`issue ${issue} body: ${body.kind}`)
	if (body.text === undefined) return { declared: undefined, is_adopted: false }

	return {
		declared: declared_of(body.text),
		is_adopted: issue_body_adopt_branch.read(body.text).kind === 'row',
	}
}

async function read(issue: string): Promise<DeclaredSize | undefined> {
	const lane = await read_lane(issue)

	return lane.declared
}

const issue_declared_size = { read, read_lane }

export { issue_declared_size }
export type { LaneDeclaration }
