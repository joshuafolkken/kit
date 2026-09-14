import type { DocumentBreakdown } from '#scripts/cost/cost-documents'

// The absent-key builders for `exactOptionalPropertyTypes`: a flag that was not given contributes no
// key at all rather than an `{ x: undefined }` the type rejects. Gathered in one module so `cost-cli`
// assembles its options and reports from named builders rather than a wall of near-identical shims.
function session(value: string | undefined): { session?: string } {
	return value === undefined ? {} : { session: value }
}

function issue(value: number | undefined): { issue?: number } {
	return value === undefined ? {} : { issue: value }
}

function over(value: number | undefined): { over?: number } {
	return value === undefined ? {} : { over: value }
}

function cap(value: number | undefined): { cap?: number } {
	return value === undefined ? {} : { cap: value }
}

// The token cap threaded into a report so the simulation is computed where the records are. Kept
// apart from `cap`: that one carries the parsed CLI flag, this one the report-input field.
function cap_tokens(value: number | undefined): { cap_tokens?: number } {
	return value === undefined ? {} : { cap_tokens: value }
}

function documents(value: DocumentBreakdown | undefined): { documents?: DocumentBreakdown } {
	return value === undefined ? {} : { documents: value }
}

// The target project directory (joshuafolkken/kit#1987): an unspecified target contributes no key,
// so `--path`'s absence keeps the former `cwd` behavior.
function target_path(value: string | undefined): { path?: string } {
	return value === undefined ? {} : { path: value }
}

const cost_optional = { session, issue, over, cap, cap_tokens, documents, target_path }

export { cost_optional }
