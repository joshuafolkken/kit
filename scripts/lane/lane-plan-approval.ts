import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_read } from '#scripts/issue/issue-read'
import { json_value } from '#scripts/lib/json-value'
import { file_reader } from '#scripts/lib/read-file'
import { z } from 'zod'
import type { LanePlan } from './lane-plan'

// The operator maps a human approval to this bounded scope; prose is retained as evidence, never
// interpreted as an instruction. A trusted comment alone does not approve an unbounded size bypass.
const evidence_schema = z.object({
	issue: z.number().int().positive(),
	paths: z.array(z.string().min(1)).min(1),
	source: z.url(),
	rationale: z.string().trim().min(1),
})
const lines_axis = {
	declared_lines: z.number().int().positive(),
	max_lines: z.number().int().positive(),
}
const files_axis = {
	declared_files: z.number().int().positive(),
	max_files: z.number().int().positive(),
}
// Each axis is checked on its own. The both-axes member leads: a union keeps its first match and
// strips the keys that member does not declare (joshuafolkken/kit#6657).
const scope_schema = z.union([
	evidence_schema.extend({ ...lines_axis, ...files_axis }),
	evidence_schema.extend(lines_axis),
	evidence_schema.extend(files_axis),
])
const approval_schema = z.intersection(
	scope_schema,
	z.object({ author: z.string(), body: z.string() }),
)
type SizeApproval = z.infer<typeof approval_schema>
const FLAG = '--size-approval'
const FLAG_WIDTH = 2

function split(argv: ReadonlyArray<string>): { tokens: ReadonlyArray<string>; file?: string } {
	const at = argv.indexOf(FLAG)
	if (at === -1) return { tokens: argv }

	return {
		tokens: [...argv.slice(0, at), ...argv.slice(at + FLAG_WIDTH)],
		file: argv[at + 1] ?? '',
	}
}

function is_source(
	row: { html_url?: string | undefined; is_trusted: boolean | undefined },
	source: string,
): boolean {
	return row.html_url === source && row.is_trusted === true
}

function scope_of(file: string): z.infer<typeof scope_schema> | undefined {
	const text = file_reader.read_if_readable(file) ?? ''

	return json_value.parse_with(text, scope_schema)
}

async function read(file: string, issue: number): Promise<SizeApproval | undefined> {
	const scope = scope_of(file)
	if (scope?.issue !== issue) return undefined
	const raw = await git_gh_issue_read.issue_list_comments(String(issue))
	const comments = await issue_read.parse_comments(raw)
	const comment = comments?.find((row) => is_source(row, scope.source))
	if (comment === undefined) return undefined

	return { ...scope, author: comment.author, body: comment.body }
}

async function attach(plan: LanePlan, file: string | undefined): Promise<LanePlan | undefined> {
	if (file === undefined) return plan
	const approval = await read(file, plan.issue)

	return approval === undefined ? undefined : { ...plan, size_approval: approval }
}

function bounds(
	approval: SizeApproval,
	reason: 'lines' | 'files',
): { declared: number; max: number } | undefined {
	if (reason === 'lines' && 'declared_lines' in approval) {
		return { declared: approval.declared_lines, max: approval.max_lines }
	}

	if (reason === 'files' && 'declared_files' in approval) {
		return { declared: approval.declared_files, max: approval.max_files }
	}

	return undefined
}

function allows(
	approval: SizeApproval,
	plan: LanePlan,
	over: { reason: 'lines' | 'files'; declared: number; measured: number },
): boolean {
	const bound = bounds(approval, over.reason)
	if (bound === undefined) return false

	return (
		approval.issue === plan.issue &&
		plan.paths.every((file) => approval.paths.includes(file)) &&
		over.declared === bound.declared &&
		over.measured <= bound.max
	)
}

const lane_plan_approval = { allows, approval_schema, attach, read, split }

export { lane_plan_approval }
