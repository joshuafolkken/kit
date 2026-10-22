import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import { FULL_PAGE_QUERY, git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'

// The status check contexts the base branch's rules require, which is what lets the merge gate tell
// a pull request held only by a slow optional check — GitHub's default-setup `CodeQL` — from one
// still waiting on a check that guards the merge (joshuafolkken/kit#4351).
//
// **An empty answer keeps the gate strict, so every gap folds into it.** With no required context
// known, `git-pr-checks-eval.ts` waits for `CLEAN` exactly as it did before, so a repository with no
// ruleset, a token the endpoint answers 403 to, or a rate limit costs the wait time it always did and
// never a merge past a check nobody declared optional.

const REQUIRED_STATUS_CHECKS_RULE = 'required_status_checks'

const required_check_schema = z.looseObject({ context: z.string() })

const rule_parameters_schema = z.looseObject({
	required_status_checks: z.array(required_check_schema).optional(),
})

const branch_rule_schema = z.looseObject({
	type: z.string(),
	parameters: rule_parameters_schema.nullish(),
})

type BranchRule = z.infer<typeof branch_rule_schema>

// A branch's rules do not change while one command waits on a pull request, so a read is remembered
// for the life of the command; one that failed is not, and the next poll asks again.
const required_contexts_by_branch = new Map<string, Array<string>>()

function forget_branch_rules(): void {
	required_contexts_by_branch.clear()
}

function to_required_contexts(rules: ReadonlyArray<BranchRule>): Array<string> {
	return rules
		.filter((rule) => rule.type === REQUIRED_STATUS_CHECKS_RULE)
		.flatMap((rule) => rule.parameters?.required_status_checks ?? [])
		.map((check) => check.context)
}

async function fetch_required_contexts(branch_name: string): Promise<Array<string> | undefined> {
	const raw_json = await git_gh_exec.exec_gh_api({
		path: `${git_gh_api_path.branch_rules_api_path(branch_name)}${FULL_PAGE_QUERY}`,
		should_paginate: true,
	})
	const rules = parse_json_array_or_undefined(raw_json, branch_rule_schema)

	return rules === undefined ? undefined : to_required_contexts(rules)
}

async function read_required_contexts(branch_name: string | undefined): Promise<Array<string>> {
	if (branch_name === undefined) return []
	const cached = required_contexts_by_branch.get(branch_name)
	if (cached !== undefined) return cached

	try {
		const contexts = await fetch_required_contexts(branch_name)
		if (contexts === undefined) return []
		required_contexts_by_branch.set(branch_name, contexts)

		return contexts
	} catch {
		return []
	}
}

const git_gh_branch_rules = { read_required_contexts }

export { git_gh_branch_rules, read_required_contexts, forget_branch_rules }
