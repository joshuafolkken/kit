import { json_value } from '#scripts/lib/json-value'

// `josh start` sets a project up for the GitHub Issue workflow and `josh init` alone does not. The
// difference decides whether a `basic` project receives `.claude/settings.json`, whose permissions,
// hooks and plugin an unattended `backlogrun` agent runs on (#3796).
//
// `josh start` hands the mark to the setup it runs through this variable, not an argument: that setup
// may be the project's own kit it hands off to or a toolkit's command (`--init-command`), and an older
// one refuses an argument it does not know but ignores a variable. The setup records the mark in
// `package.json`, where every later `josh init` and `josh sync` reads it.
const WORKFLOW_ENV = 'JOSH_WORKFLOW'
const GITHUB_WORKFLOW = 'github'

function is_requested(environment: NodeJS.ProcessEnv = process.env): boolean {
	return environment[WORKFLOW_ENV] === GITHUB_WORKFLOW
}

function is_recorded(manifest: Record<string, unknown> | undefined): boolean {
	const josh = manifest?.['josh']

	return json_value.is_record(josh) && josh['workflow'] === GITHUB_WORKFLOW
}

function request(environment: NodeJS.ProcessEnv = process.env): void {
	environment[WORKFLOW_ENV] = GITHUB_WORKFLOW
}

// The `josh` record's field for the mark — none for a project `josh start` did not set up, so a
// `josh init` never writes the mark of its own accord.
function recorded_fields(has_workflow: boolean): Record<string, string> {
	return has_workflow ? { workflow: GITHUB_WORKFLOW } : {}
}

const workflow_mark = { is_requested, is_recorded, request, recorded_fields }
export { workflow_mark }
