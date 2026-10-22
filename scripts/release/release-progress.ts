import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { PACKAGE_JSON, package_manifest } from '#scripts/lib/package-manifest'
import { poll } from '#scripts/lib/poll'
import { npm_registry } from '#scripts/version/npm-registry'
import { z } from 'zod'
import { release_publish_run } from './release-publish-run'
import { release_tag } from './release-tag'

// The stage lines `pnpm josh release` prints, and the two stages it waits for after the tag.
//
// **The tag starts the distribution, it does not finish it.** `publish.yml` runs off the tag:
// `publish-npm` puts the version on npm and `create-release` opens the GitHub Release once the
// publishing jobs pass. Stopping at the tag would call the release published ahead of both, so the
// command waits for each, prints one line per stage reached, and prints the completion line only
// when every stage has — a stage that times out, or whose Publish run fails first, is named with ❌
// and the run exits non-zero.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const NPM_TIMEOUT_ENV = 'JOSH_RELEASE_NPM_TIMEOUT_SECONDS'
const GITHUB_RELEASE_TIMEOUT_ENV = 'JOSH_RELEASE_GITHUB_RELEASE_TIMEOUT_SECONDS'
const NPM_PACKAGE_PAGE = 'https://www.npmjs.com/package'
const HTML_URL_FILTER = '.html_url'

// `private: true` is the manifest's own "never published to npm" — `josh release` is distributed to
// consumers whose packages are not on npm, so the npm stage is skipped for them rather than timed out.
// Only the npm stage reads the name, so a private manifest needs none — the basic profile's
// `josh init` writes `{ "private": true }` without one.
const manifest_schema = z.looseObject({
	name: z.string().optional(),
	private: z.boolean().optional(),
})

type ReleaseManifest = { is_private: true } | { is_private: false; name: string }
type NpmState = { kind: 'published' } | { kind: 'failed'; run_id: number } | { kind: 'pending' }

function read_manifest(cwd: string): ReleaseManifest {
	const manifest = package_manifest.read_manifest_if_valid(cwd, manifest_schema) ?? {}

	if (manifest.private === true) return { is_private: true }
	if (manifest.name === undefined) throw new Error(`${PACKAGE_JSON} in ${cwd} has no package name.`)

	return { is_private: false, name: manifest.name }
}

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

// The run's own failure is known, so the line names the run rather than a stage that never came. It
// claims no more than the last registry read: a job beside `publish-npm` can fail the run after npm
// took the version.
function failed_publish_line(version: string, run_id: number): string {
	const tag = release_tag.tag_name(version)

	return [
		`❌ Publish ${tag} failed (run ${String(run_id)}) before npm listed ${tag}.`,
		`  Inspect it with: gh run view ${String(run_id)} --log-failed`,
	].join('\n')
}

function missed_release_line(version: string): string {
	return [
		`❌ No GitHub Release: ${release_tag.tag_name(version)} never got one.`,
		`  Check the Publish run for ${release_tag.tag_name(version)}: its create-release job did not finish.`,
	].join('\n')
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
	if (state.kind === 'failed') return failed_publish_line(version, state.run_id)

	return missed_npm_line(package_name, version)
}

async function npm_state(package_name: string, version: string): Promise<NpmState> {
	if (npm_registry.has_public_version(package_name, version)) return { kind: 'published' }
	const run_id = await release_publish_run.failed_run_id(version)

	return run_id === undefined ? { kind: 'pending' } : { kind: 'failed', run_id }
}

async function wait_for_npm(manifest: ReleaseManifest, version: string): Promise<boolean> {
	if (manifest.is_private) return true
	// `poll_until` answers only whether it stopped, so the state the last read found is kept here.
	const seen: { state: NpmState } = { state: { kind: 'pending' } }

	await poll.poll_until(async () => {
		seen.state = await npm_state(manifest.name, version)

		return seen.state.kind !== 'pending'
	}, release_tag.poll_options_for(NPM_TIMEOUT_ENV))

	console.info(npm_outcome_line(manifest.name, version, seen.state))

	return seen.state.kind === 'published'
}

async function wait_for_github_release(version: string): Promise<boolean> {
	// `poll_until` answers only whether it succeeded, so the URL the last read found is kept here.
	const found: { url: string | undefined } = { url: undefined }

	await poll.poll_until(async () => {
		found.url = await read_release_url(version)

		return found.url !== undefined
	}, release_tag.poll_options_for(GITHUB_RELEASE_TIMEOUT_ENV))

	console.info(
		found.url === undefined ? missed_release_line(version) : github_release_line(found.url),
	)

	return found.url !== undefined
}

// Runs in the release work tree, whose manifest names the package being released. The stages run in
// `publish.yml`'s order, and a stage that is not reached ends the run: what follows it is gated on it.
async function wait_for_distribution(version: string): Promise<number> {
	const manifest = read_manifest(process.cwd())

	if (!(await wait_for_npm(manifest, version)) || !(await wait_for_github_release(version))) {
		return FAILURE_EXIT_CODE
	}

	console.info(complete_line(version))

	return SUCCESS_EXIT_CODE
}

const release_progress = {
	npm_package_url,
	pr_merged_line,
	pr_opened_line,
	read_manifest,
	wait_for_distribution,
	GITHUB_RELEASE_TIMEOUT_ENV,
	NPM_TIMEOUT_ENV,
}

export { release_progress }
