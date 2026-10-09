import { yaml_document } from '#scripts/lib/yaml-document'
import { z } from 'zod'

// The status checks kit's distributed workflows report, keyed by the workflow that reports them —
// the single source `josh ruleset:check` and `josh doctor` compare a repository's required status
// checks against. Each name is the job's `name:`, the string a ruleset's
// required check is matched by; `required-checks-logic.test.ts` reads it back off the workflows.
//
// `E2E` belongs here even though `josh followup` deliberately does not wait on it:
// a ruleset counts a skipped job as passing, and the job is skipped when the
// project has no E2E suite, so requiring it never blocks a merge — it only refuses a red one.
interface WorkflowChecks {
	workflow: string
	checks: ReadonlyArray<string>
}

const CI_WORKFLOW = '.github/workflows/ci.yml'
const SONAR_WORKFLOW = '.github/workflows/sonar-qube.yml'
const CLASSIFICATION_WORKFLOW = '.github/workflows/pr-classification.yml'
const REQUIRED_STATUS_CHECKS = 'required_status_checks'
const NOT_FOUND_STATUS = 404

const DISTRIBUTED_CHECKS: ReadonlyArray<WorkflowChecks> = [
	{ workflow: CI_WORKFLOW, checks: ['Checks', 'Detect E2E', 'E2E', 'Security Audit'] },
	{ workflow: SONAR_WORKFLOW, checks: ['SonarQube'] },
	{ workflow: CLASSIFICATION_WORKFLOW, checks: ['Release classification'] },
]

// Where the repository's required checks live. A ruleset is the source `--apply` writes to; classic
// branch protection is read beside it, and is the source for a repository that never moved to rulesets.
type RequiredSource =
	| { kind: 'ruleset'; ruleset_id: number; contexts: ReadonlyArray<string> }
	| { kind: 'protection'; contexts: ReadonlyArray<string> }
	| { kind: 'none' }
	| { kind: 'unreadable' }

const status_check_schema = z.looseObject({ context: z.string() })
const branch_rule_schema = z.looseObject({
	type: z.literal(REQUIRED_STATUS_CHECKS),
	ruleset_id: z.number(),
	parameters: z.looseObject({ required_status_checks: z.array(status_check_schema) }),
})
const protection_schema = z.looseObject({ contexts: z.array(z.string()) })
const ruleset_rule_schema = z.looseObject({
	type: z.string(),
	parameters: z
		.looseObject({ required_status_checks: z.array(status_check_schema).optional() })
		.optional(),
})
const ruleset_schema = z.looseObject({ rules: z.array(ruleset_rule_schema) })
const workflow_job_schema = z.looseObject({ name: z.string().optional() })
const workflow_schema = z.looseObject({ jobs: z.record(z.string(), workflow_job_schema) })

// One `gh api` read: the body it answered, or the HTTP status it failed with (`undefined` when
// nothing answered at all).
type ApiRead = { kind: 'body'; stdout: string } | { kind: 'failed'; status: number | undefined }

type BranchRule = z.infer<typeof branch_rule_schema>
type RulesetRule = z.infer<typeof ruleset_rule_schema>

function parse_yaml_safe(content: string): unknown {
	try {
		return yaml_document.parse_yaml(content)
	} catch {
		return undefined
	}
}

// The job `name:`s a workflow defines — the contexts it reports. A file that does not parse, or has
// no `jobs` mapping, reports nothing.
function workflow_job_names(content: string): Array<string> {
	const parsed = workflow_schema.safeParse(parse_yaml_safe(content))
	if (!parsed.success) return []

	return Object.values(parsed.data.jobs).flatMap((job) => job.name ?? [])
}

// The checks this repository should require: only those a workflow it has actually reports. A file
// of the same name is not enough — a project's own `ci.yml` with a `build` job is never told to
// require `Checks`, which nothing there would ever report.
function expected_checks(read_workflow: (workflow: string) => string | undefined): Array<string> {
	return DISTRIBUTED_CHECKS.flatMap((entry) => {
		const content = read_workflow(entry.workflow)
		if (content === undefined) return []
		const reported = workflow_job_names(content)

		return entry.checks.filter((check) => reported.includes(check))
	})
}

function parse_json(stdout: string): unknown {
	try {
		return JSON.parse(stdout)
	} catch {
		return undefined
	}
}

function status_check_rules(payload: unknown): Array<BranchRule> {
	if (!Array.isArray(payload)) return []

	return payload.flatMap((entry: unknown) => {
		const parsed = branch_rule_schema.safeParse(entry)

		return parsed.success ? [parsed.data] : []
	})
}

// `GET repos/{owner}/{repo}/rules/branches/{branch}` — every rule in force on the branch, across
// rulesets. The contexts of all of them are combined, since each is enforced; the first ruleset is the
// one `--apply` writes to. No `required_status_checks` rule at all reads as `none`.
function parse_branch_rules(stdout: string | undefined): RequiredSource {
	const payload = stdout === undefined ? undefined : parse_json(stdout)
	if (!Array.isArray(payload)) return { kind: 'unreadable' }
	const rules = status_check_rules(payload)
	const [first] = rules
	if (first === undefined) return { kind: 'none' }
	const contexts = rules.flatMap((rule) =>
		rule.parameters.required_status_checks.map((check) => check.context),
	)

	return { kind: 'ruleset', ruleset_id: first.ruleset_id, contexts }
}

// `GET …/branches/{branch}/protection/required_status_checks`. GitHub answers a branch without
// protection (or without required checks) with a 404, which alone reads as `none`. Any other
// failure — a 403 for a caller without admin access, a 5xx, a timeout — or a body that is not the
// expected document reads as `unreadable`, so a check that is in fact required is never reported
// missing.
function parse_protection(read: ApiRead): RequiredSource {
	if (read.kind === 'failed') {
		return { kind: read.status === NOT_FOUND_STATUS ? 'none' : 'unreadable' }
	}

	const parsed = protection_schema.safeParse(parse_json(read.stdout))

	return parsed.success
		? { kind: 'protection', contexts: parsed.data.contexts }
		: { kind: 'unreadable' }
}

// GitHub enforces rulesets and classic protection together, so a check either one requires is
// required. The ruleset stays the source `--apply` writes to; a protection read that failed for any
// reason but a 404 leaves the whole answer `unreadable`, as a lone protection read would.
function combine_sources(rules: RequiredSource, protection: RequiredSource): RequiredSource {
	if (rules.kind !== 'ruleset') return protection
	if (protection.kind === 'none') return rules
	if (protection.kind !== 'protection') return { kind: 'unreadable' }

	return { ...rules, contexts: [...new Set([...rules.contexts, ...protection.contexts])] }
}

function missing_checks(
	expected: ReadonlyArray<string>,
	contexts: ReadonlyArray<string>,
): Array<string> {
	return expected.filter((check) => !contexts.includes(check))
}

function with_added_checks(rule: RulesetRule, missing: ReadonlyArray<string>): RulesetRule {
	if (rule.type !== REQUIRED_STATUS_CHECKS || rule.parameters === undefined) return rule
	const current = rule.parameters.required_status_checks ?? []
	const added = missing.map((context) => ({ context }))

	return {
		...rule,
		parameters: { ...rule.parameters, required_status_checks: [...current, ...added] },
	}
}

// The `PUT repos/{owner}/{repo}/rulesets/{id}` body: the ruleset's own rules, unchanged but for the
// missing contexts appended to its required-checks rule. `rules` replaces the whole list, so every
// other rule is carried over as read rather than dropped.
function ruleset_update_body(
	ruleset_stdout: string,
	missing: ReadonlyArray<string>,
): string | undefined {
	const parsed = ruleset_schema.safeParse(parse_json(ruleset_stdout))
	if (!parsed.success) return undefined

	return JSON.stringify({
		rules: parsed.data.rules.map((rule) => with_added_checks(rule, missing)),
	})
}

// The `POST …/protection/required_status_checks/contexts` body, which appends rather than replaces.
function protection_update_body(missing: ReadonlyArray<string>): string {
	return JSON.stringify({ contexts: missing })
}

const required_checks_logic = {
	DISTRIBUTED_CHECKS,
	workflow_job_names,
	expected_checks,
	parse_branch_rules,
	parse_protection,
	combine_sources,
	missing_checks,
	ruleset_update_body,
	protection_update_body,
}

export type { ApiRead, RequiredSource, WorkflowChecks }
export { required_checks_logic }
