import path from 'node:path'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { poll } from '#scripts/lib/poll'
import { file_reader } from '#scripts/lib/read-file'
import { npm_registry } from '#scripts/version/npm-registry'
import { release_publish_run, type FailedRun } from './release-publish-run'
import { release_tag } from './release-tag'

// The stage lines `pnpm josh release` prints, and the two stages it waits for after the tag.
//
// **The tag starts the distribution, it does not finish it.** `publish.yml` runs off the tag:
// `publish-npm` puts the version on npm and `create-release` opens the GitHub Release once the
// publishing jobs pass. Stopping at the tag would call the release published ahead of both, so the
// command waits for each, prints one line per stage reached, and prints the completion line only
// when every stage has — a stage that times out, or whose Publish run fails first, is named with ❌
// and the run exits non-zero. In a consumer the distributed `GitHub Release` workflow opens the
// release instead.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const NPM_TIMEOUT_ENV = 'JOSH_RELEASE_NPM_TIMEOUT_SECONDS'
const GITHUB_RELEASE_TIMEOUT_ENV = 'JOSH_RELEASE_GITHUB_RELEASE_TIMEOUT_SECONDS'
const NPM_PACKAGE_PAGE = 'https://www.npmjs.com/package'
const HTML_URL_FILTER = '.html_url'
const PUBLISH_WORKFLOW_PATH = '.github/workflows/publish.yml'
const RELEASE_WORKFLOW_PATH = '.github/workflows/github-release.yml'

type NpmState = { kind: 'published' } | { kind: 'failed'; run: FailedRun } | { kind: 'pending' }

function pr_opened_line(pr_url: string): string {
	return `📝 Release PR opened: ${pr_url}`
}

function pr_merged_line(pr_url: string): string {
	return `🔀 Release PR merged: ${pr_url}`
}

function npm_package_url(package_name: string, version: string): string {
	return `${NPM_PACKAGE_PAGE}/${package_name}/v/${version}`
}

function npm_line(package_name: string, version: string): string {
	return `📦 Published to npm: ${npm_package_url(package_name, version)}`
}

function github_release_line(release_url: string): string {
	return `📰 GitHub Release created: ${release_url}`
}

function complete_line(version: string): string {
	return `🎉 Release ${release_tag.tag_name(version)} complete`
}

// Like the tag's failure text, these say which stage was not reached rather than guess at why: the
// command sees only that the thing it waited for never appeared.
function missed_npm_line(package_name: string, version: string): string {
	return [
		`❌ Not published to npm: ${package_name}@${version} never appeared on the registry.`,
		`  Check the Publish run for ${release_tag.tag_name(version)}: its publish-npm job did not finish.`,
	].join('\n')
}

function failed_run_headline(tag: string, run: FailedRun): string {
	const run_label = `Publish ${tag} failed (run ${String(run.run_id)})`

	if (run.has_npm_job_failed) return `❌ ${run_label} before npm listed ${tag}.`

	return `❌ ${run_label} in ${run.failed_jobs.join(', ')}; its publish-npm job did not fail.`
}

// The run's own failure is known, so the line names the run rather than a stage that never came. It
// claims no more than the last registry read: when a job beside `publish-npm` failed the run, npm
// may still take the version, so the npm side is reported as unconfirmed rather than failed.
function failed_publish_line(package_name: string, version: string, run: FailedRun): string {
	const tag = release_tag.tag_name(version)
	const npm_lines = run.has_npm_job_failed
		? []
		: [`  npm has not listed ${tag} yet: check ${npm_package_url(package_name, version)}`]

	return [
		failed_run_headline(tag, run),
		...npm_lines,
		`  Inspect it with: gh run view ${String(run.run_id)} --log-failed`,
	].join('\n')
}

function has_workflow(cwd: string, workflow_path: string): boolean {
	return file_reader.read_if_readable(path.join(cwd, workflow_path)) !== undefined
}

// A consumer's release comes from the `GitHub Release` workflow `josh sync` distributes — even beside
// its own `publish.yml`, which that workflow waits for. kit carries no such workflow and opens its
// release from `publish.yml`'s create-release job. The hint names the run the repository has.
function missed_release_hint(cwd: string, tag: string): string {
	if (has_workflow(cwd, RELEASE_WORKFLOW_PATH)) {
		return `  Check the GitHub Release ${tag} run: it did not create the release.`
	}

	if (has_workflow(cwd, PUBLISH_WORKFLOW_PATH)) {
		return `  Check the Publish run for ${tag}: its create-release job did not finish.`
	}

	return `  ${RELEASE_WORKFLOW_PATH} is missing: run pnpm josh sync to install the GitHub Release workflow.`
}

function missed_release_line(cwd: string, version: string): string {
	const tag = release_tag.tag_name(version)

	return [`❌ No GitHub Release: ${tag} never got one.`, missed_release_hint(cwd, tag)].join('\n')
}

// REST answers 404 until the release exists, which `exec_gh_api` throws on — so a failure here is
// "not yet", the answer the poll asks again on.
async function read_release_url(version: string): Promise<string | undefined> {
	const tag = release_tag.tag_name(version)

	try {
		const url = await git_gh_exec.exec_gh_api({
			path: git_gh_api_path.release_by_tag_api_path(tag),
			jq_filter: HTML_URL_FILTER,
		})

		return url === '' ? undefined : url
	} catch {
		return undefined
	}
}

function npm_outcome_line(package_name: string, version: string, state: NpmState): string {
	if (state.kind === 'published') return npm_line(package_name, version)
	if (state.kind === 'failed') return failed_publish_line(package_name, version, state.run)

	return missed_npm_line(package_name, version)
}

async function npm_state(package_name: string, version: string): Promise<NpmState> {
	if (npm_registry.has_public_version(package_name, version)) return { kind: 'published' }
	const run = await release_publish_run.failed_run(version)

	return run === undefined ? { kind: 'pending' } : { kind: 'failed', run }
}

// `josh release` is distributed to consumers whose packages are not on npm, so a repository that does
// not publish there (`npm_registry.published_package_name`, the one answer `josh sync` distributes
// `publish.yml` on) skips the npm stage rather than timing it out.
async function wait_for_npm(package_name: string | undefined, version: string): Promise<boolean> {
	if (package_name === undefined) return true
	// `poll_until` answers only whether it stopped, so the state the last read found is kept here.
	const seen: { state: NpmState } = { state: { kind: 'pending' } }

	await poll.poll_until(async () => {
		seen.state = await npm_state(package_name, version)

		return seen.state.kind !== 'pending'
	}, release_tag.poll_options_for(NPM_TIMEOUT_ENV))

	console.info(npm_outcome_line(package_name, version, seen.state))

	return seen.state.kind === 'published'
}

async function wait_for_github_release(cwd: string, version: string): Promise<boolean> {
	// `poll_until` answers only whether it succeeded, so the URL the last read found is kept here.
	const found: { url: string | undefined } = { url: undefined }

	await poll.poll_until(async () => {
		found.url = await read_release_url(version)

		return found.url !== undefined
	}, release_tag.poll_options_for(GITHUB_RELEASE_TIMEOUT_ENV))

	console.info(
		found.url === undefined ? missed_release_line(cwd, version) : github_release_line(found.url),
	)

	return found.url !== undefined
}

// Runs in the release work tree, whose manifest names the package being released. The stages run in
// `publish.yml`'s order, and a stage that is not reached ends the run: what follows it is gated on it.
async function wait_for_distribution(version: string): Promise<number> {
	const cwd = process.cwd()
	const package_name = npm_registry.published_package_name(cwd)

	if (
		!(await wait_for_npm(package_name, version)) ||
		!(await wait_for_github_release(cwd, version))
	) {
		return FAILURE_EXIT_CODE
	}

	console.info(complete_line(version))

	return SUCCESS_EXIT_CODE
}

const release_progress = {
	npm_package_url,
	pr_merged_line,
	pr_opened_line,
	wait_for_distribution,
	GITHUB_RELEASE_TIMEOUT_ENV,
	NPM_TIMEOUT_ENV,
}

export { release_progress }
