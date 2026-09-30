import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execaSync } from 'execa'

// The workflows that install safe-chain on the runner. Each carries the release and the installer's
// SHA-256 as workflow-level env, so one pin per file moves every "Setup safe-chain" step at once
// (joshuafolkken/kit#2711, joshuafolkken/kit#2765). A consumer has the first and the last, and
// `josh sync` rewrites both from kit, so moving them anywhere but kit is harmless and short-lived.
const WORKFLOW_PATHS = [
	'.github/workflows/ci.yml',
	'templates/workflows/ci.yml',
	'.github/workflows/pr-classification.yml',
]
// `[ \t]` rather than `\s`: under the `m` flag `\s*` would run across line ends and swallow the
// blank line that follows the env block.
const VERSION_RE = /^(?<key>[ \t]*SAFE_CHAIN_INSTALLER_VERSION:[ \t]*)(?<value>\S+)[ \t]*$/mu
const SHA256_RE = /^(?<key>[ \t]*SAFE_CHAIN_INSTALLER_SHA256:[ \t]*)(?<value>\S+)[ \t]*$/mu
const VALUE_GROUP = 'value'
const DOWNLOAD_TIMEOUT_MS = 30_000

interface InstallerPin {
	version: string
	sha256: string
}

function installer_url(version: string): string {
	return `https://github.com/AikidoSec/safe-chain/releases/download/${version}/install-safe-chain.sh`
}

function extract_pinned_version(content: string): string | undefined {
	return VERSION_RE.exec(content)?.groups?.[VALUE_GROUP]
}

function rewrite_pin(content: string, pin: InstallerPin): string {
	return content
		.replace(VERSION_RE, (_match, key: string) => `${key}${pin.version}`)
		.replace(SHA256_RE, (_match, key: string) => `${key}${pin.sha256}`)
}

function fetch_installer_sha256(version: string): string | undefined {
	// `--proto =https` keeps the release redirect from being followed onto plain HTTP.
	const result = execaSync('curl', ['--proto', '=https', '-fsSL', installer_url(version)], {
		encoding: 'buffer',
		// The hash is of the file as published; execa would otherwise drop its trailing newline.
		stripFinalNewline: false,
		reject: false,
		timeout: DOWNLOAD_TIMEOUT_MS,
	})
	if (result.exitCode !== 0 || result.stdout.length === 0) return undefined

	return createHash('sha256').update(result.stdout).digest('hex')
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

function sync(latest: string, workflow_paths: ReadonlyArray<string> = WORKFLOW_PATHS): void {
	const targets = stale_workflows(latest, workflow_paths)
	if (targets.length === 0) return

	const sha256 = fetch_installer_sha256(latest)

	if (sha256 === undefined) {
		console.warn(`\n⚠ Could not download the safe-chain ${latest} installer; CI pin left as is`)

		return
	}

	for (const workflow_path of targets) write_pin(workflow_path, { version: latest, sha256 })
}

const ci_installer_pin = {
	WORKFLOW_PATHS,
	installer_url,
	extract_pinned_version,
	rewrite_pin,
	fetch_installer_sha256,
	sync,
}

export { ci_installer_pin }
export type { InstallerPin }
