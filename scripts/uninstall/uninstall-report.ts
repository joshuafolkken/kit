import type { FilePlan } from './uninstall-plan'

interface UninstallPlan {
	files: FilePlan
	// Whether kit's dependency entry or profile record is still in `package.json` to take out.
	has_manifest_entries: boolean
	// Whether lefthook is installed here with a config kit wrote or merged into.
	has_git_hooks: boolean
	review: Array<string>
}

const NOTHING = '  (nothing)'
// The review comes first: the install runs whatever `scripts.prepare` is still in the manifest, and
// the one kit merged in installs lefthook's hooks again.
const NEXT_STEPS = [
	'First clear "Review by hand" — a `scripts.prepare` left there reinstalls the git hooks.',
	'Run `pnpm install` — it drops the package from node_modules and pnpm-lock.yaml.',
	'Delete node_modules and pnpm-lock.yaml yourself if kit was the only dependency.',
	'Labels, Issues and pull requests `josh start` created on GitHub are not touched.',
]

function section(title: string, lines: ReadonlyArray<string>): string {
	const body = lines.length === 0 ? [NOTHING] : lines.map((line) => `  ${line}`)

	return [`${title}:`, ...body].join('\n')
}

function removal_lines(plan: UninstallPlan): Array<string> {
	const lines = [...plan.files.remove]

	if (plan.has_manifest_entries) {
		lines.push('package.json — the @joshuafolkken/kit dependency and the josh.profile record')
	}

	if (plan.has_git_hooks) lines.push('git hooks installed by lefthook (lefthook uninstall)')

	return lines
}

// Printed before anything is deleted, so the three lists are the whole of what the command will do
// and of what it leaves for a person: nothing outside the first one is ever written to.
function describe(plan: UninstallPlan): string {
	return [
		section('Remove (still exactly what kit wrote)', removal_lines(plan)),
		section('Keep (differs from what kit writes — remove kit lines by hand)', plan.files.keep),
		section('Review by hand (kit cannot tell these from your own)', plan.review),
	].join('\n\n')
}

function next_steps(): string {
	return section('Next', NEXT_STEPS)
}

function is_empty(plan: UninstallPlan): boolean {
	return removal_lines(plan).length === 0
}

const uninstall_report = { describe, next_steps, is_empty }

export { uninstall_report }
export type { UninstallPlan }
