import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const SAFE_CHAIN_PKG = '@aikidosec/safe-chain'
const VERSION_RE = /@aikidosec\/safe-chain@([^\s"']+)/u
const NPM_TIMEOUT_MS = 30_000

interface PreinstallInfo {
	content: string
	current_version: string
}

function extract_pinned_version(preinstall: string): string | undefined {
	return VERSION_RE.exec(preinstall)?.[1]
}

function fetch_latest_version(): string | undefined {
	const result = spawnSync('npm', ['view', SAFE_CHAIN_PKG, 'version'], {
		encoding: 'utf8',
		shell: false,
		timeout: NPM_TIMEOUT_MS,
	})
	if (result.status !== 0 || !result.stdout) return undefined

	return result.stdout.trim()
}

function rewrite_version(content: string, current_version: string, next_version: string): string {
	return content.replace(
		`${SAFE_CHAIN_PKG}@${current_version}`,
		`${SAFE_CHAIN_PKG}@${next_version}`,
	)
}

function read_preinstall_info(package_json_path: string): PreinstallInfo | undefined {
	const content = readFileSync(package_json_path, 'utf8')
	const package_json = JSON.parse(content) as { scripts?: { preinstall?: string } }
	const preinstall = package_json.scripts?.preinstall
	if (!preinstall) return undefined

	const current_version = extract_pinned_version(preinstall)
	if (!current_version) return undefined

	return { content, current_version }
}

function write_if_updated(
	package_json_path: string,
	content: string,
	current: string,
	latest: string,
): void {
	if (current === latest) {
		console.info(`\n✔ ${SAFE_CHAIN_PKG} preinstall already at ${latest}`)

		return
	}

	console.info(`\n↑ Updating ${SAFE_CHAIN_PKG} preinstall: ${current} → ${latest}`)
	writeFileSync(package_json_path, rewrite_version(content, current, latest), 'utf8')
}

function sync(package_json_path: string): void {
	const info = read_preinstall_info(package_json_path)
	if (!info) return

	const latest = fetch_latest_version()

	if (!latest) {
		console.warn(`\n⚠ Could not fetch latest version of ${SAFE_CHAIN_PKG}; skipping`)

		return
	}

	write_if_updated(package_json_path, info.content, info.current_version, latest)
}

const preinstall_version_update = {
	sync,
	extract_pinned_version,
	fetch_latest_version,
	rewrite_version,
}

export { preinstall_version_update }
