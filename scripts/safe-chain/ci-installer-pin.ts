import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { composite_actions } from '#scripts/ci/composite-actions'
import { execaSync } from 'execa'

// Where the workflows that install safe-chain on the runner live. Each carries the release and the
// installer's SHA-256 as workflow-level env, so one pin per file moves every "Setup safe-chain" step
// at once. The directories are scanned rather than
// a file list kept, so a workflow another package distributes — app-kit's `dast.yml` and `load.yml`
// — moves with the rest; a file without the pin is never a target.
const WORKFLOW_DIRECTORIES = ['.github/workflows', 'templates/workflows']
const WORKFLOW_FILE_RE = /\.ya?ml$/u
// `[ \t]` rather than `\s`: under the `m` flag `\s*` would run across line ends and swallow the
// blank line that follows the env block.
const VERSION_RE = /^(?<key>[ \t]*SAFE_CHAIN_INSTALLER_VERSION:[ \t]*)(?<value>\S+)[ \t]*$/mu
const SHA256_RE = /^(?<key>[ \t]*SAFE_CHAIN_INSTALLER_SHA256:[ \t]*)(?<value>\S+)[ \t]*$/mu
const VALUE_GROUP = 'value'
const DOWNLOAD_TIMEOUT_MS = 30_000
const REPOSITORY = 'AikidoSec/safe-chain'
const INSTALLER_NAME = 'install-safe-chain.sh'
const ATTESTATION_FAILURE = 'could not be verified against its release attestation'

interface InstallerPin {
	version: string
	sha256: string
}

function installer_url(version: string): string {
	return `https://github.com/${REPOSITORY}/releases/download/${version}/${INSTALLER_NAME}`
}

// The local composite actions follow the workflows: kit's own pin lives in
// `.github/actions/setup-pnpm`, which every kit workflow installs through.
function list_workflows(): Array<string> {
	const workflows = WORKFLOW_DIRECTORIES.filter((directory) => existsSync(directory)).flatMap(
		(directory) =>
			readdirSync(directory)
				.filter((file_name) => WORKFLOW_FILE_RE.test(file_name))
				.toSorted((left, right) => left.localeCompare(right))
				.map((file_name) => `${directory}/${file_name}`),
	)

	return [...workflows, ...composite_actions.list()]
}

function extract_pinned_version(content: string): string | undefined {
	return VERSION_RE.exec(content)?.groups?.[VALUE_GROUP]
}

function rewrite_pin(content: string, pin: InstallerPin): string {
	return content
		.replace(VERSION_RE, (_match, key: string) => `${key}${pin.version}`)
		.replace(SHA256_RE, (_match, key: string) => `${key}${pin.sha256}`)
}

function fetch_installer(version: string): Uint8Array | undefined {
	// `--proto =https` keeps the release redirect from being followed onto plain HTTP.
	const result = execaSync('curl', ['--proto', '=https', '-fsSL', installer_url(version)], {
		encoding: 'buffer',
		// The hash is of the file as published; execa would otherwise drop its trailing newline.
		stripFinalNewline: false,
		reject: false,
		timeout: DOWNLOAD_TIMEOUT_MS,
	})
	if (result.exitCode !== 0 || result.stdout.length === 0) return undefined

	return result.stdout
}

// joshuafolkken/kit#4669: the hash recorded is the one the release's GitHub attestation signs, not
// whatever the download happened to return. `gh release verify-asset` checks the signed attestation
// GitHub issued when the release was published, so a release asset swapped afterwards fails here.
function verify_installer(version: string, installer: Uint8Array): boolean {
	const directory = mkdtempSync(path.join(tmpdir(), 'safe-chain-installer-'))
	const installer_path = path.join(directory, INSTALLER_NAME)

	try {
		writeFileSync(installer_path, installer)
		const result = execaSync(
			'gh',
			['release', 'verify-asset', version, installer_path, '--repo', REPOSITORY],
			{
				reject: false,
				timeout: DOWNLOAD_TIMEOUT_MS,
			},
		)

		return result.exitCode === 0
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

// The hash to record, or why there is none — a pin is written only from a verified installer.
function fetch_installer_sha256(version: string): { sha256: string } | { failure: string } {
	const installer = fetch_installer(version)
	if (installer === undefined) return { failure: 'could not be downloaded' }
	// A missing or signed-out `gh` lands here too: no verification means no pin, whatever the reason.
	if (!verify_installer(version, installer)) return { failure: ATTESTATION_FAILURE }

	return { sha256: createHash('sha256').update(installer).digest('hex') }
}

// The workflows whose pin lags `latest` — a missing file or one without the pin is not a target.
function stale_workflows(latest: string, workflow_paths: ReadonlyArray<string>): Array<string> {
	return workflow_paths.filter((workflow_path) => {
		if (!existsSync(workflow_path)) return false
		const current = extract_pinned_version(readFileSync(workflow_path, 'utf8'))

		return current !== undefined && current !== latest
	})
}

function write_pin(workflow_path: string, pin: InstallerPin): void {
	console.info(`\n↑ Updating safe-chain installer in ${workflow_path} → ${pin.version}`)
	writeFileSync(workflow_path, rewrite_pin(readFileSync(workflow_path, 'utf8'), pin), 'utf8')
}

function sync(latest: string, workflow_paths: ReadonlyArray<string> = list_workflows()): void {
	const targets = stale_workflows(latest, workflow_paths)
	if (targets.length === 0) return

	const fetched = fetch_installer_sha256(latest)

	if ('failure' in fetched) {
		console.warn(`\n⚠ The safe-chain ${latest} installer ${fetched.failure}; CI pin left as is`)

		return
	}

	for (const workflow_path of targets) {
		write_pin(workflow_path, { version: latest, sha256: fetched.sha256 })
	}
}

const ci_installer_pin = {
	list_workflows,
	installer_url,
	extract_pinned_version,
	rewrite_pin,
	fetch_installer_sha256,
	sync,
}

export { ci_installer_pin }
export type { InstallerPin }
