#!/usr/bin/env tsx
/**
 * Bump pnpm via `corepack use` to the newest release on the project's CURRENT major.
 *
 * Two failure modes this guards against, both of which used to abort the whole
 * `josh latest` chain (taking `latest:update` and `audit` down with them):
 *
 * 1. `corepack use pnpm@latest` follows npm's `latest` dist-tag, which is
 *    independent of `devEngines` and can momentarily point to an OLDER major than
 *    the devEngines floor (e.g. a pnpm 10.x backport tagged `latest` while this
 *    repo runs 11.x). corepack then rejects the pin and exits non-zero. Pinning to
 *    pnpm's per-major dist-tag `latest-<major>` keeps updates within the adopted
 *    major and never drops below `devEngines`.
 *
 * 2. The maintenance chain runs under safe-chain, which proxies the registry and
 *    suppresses package versions newer than `minimum-release-age`. Right after a
 *    pnpm release the target version is filtered out, so `corepack use` fails with
 *    "Tag not found". That is expected and transient — the bump simply happens on a
 *    later run once the version ages past the window. So a corepack failure here is
 *    logged and swallowed (exit 0) instead of aborting the chain.
 *
 * Usage: tsx scripts/latest-corepack.ts
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PACKAGE_JSON_PATH = 'package.json'
const PACKAGE_MANAGER_RE = /"packageManager"\s*:\s*"pnpm@(\d+)\./u
const FALLBACK_TARGET = 'pnpm@latest'

function extract_pnpm_major(package_json_content: string): string | undefined {
	return PACKAGE_MANAGER_RE.exec(package_json_content)?.[1]
}

function build_corepack_target(major: string | undefined): string {
	if (major === undefined) return FALLBACK_TARGET

	return `pnpm@latest-${major}`
}

function resolve_corepack_target(package_json_content: string): string {
	return build_corepack_target(extract_pnpm_major(package_json_content))
}

function run_corepack(target: string): number {
	console.info(`\n▶ corepack use ${target}`)
	const result = spawnSync('corepack', ['use', target], { stdio: 'inherit', shell: false })

	return result.status ?? 1
}

// Non-fatal: keep the josh latest chain (latest:update, audit) running. A non-zero
// status here is usually the target version being newer than the registry
// release-age window; it will bump on a later run. Returns whether a skip happened.
function warn_if_skipped(status: number): boolean {
	if (status === 0) return false

	console.warn(`⚠ Skipped pnpm bump (corepack exited ${String(status)}); the chain continues.`)

	return true
}

function main(): void {
	const target = resolve_corepack_target(readFileSync(PACKAGE_JSON_PATH, 'utf8'))

	warn_if_skipped(run_corepack(target))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const latest_corepack = {
	extract_pnpm_major,
	build_corepack_target,
	resolve_corepack_target,
	run_corepack,
	warn_if_skipped,
	main,
}

export { latest_corepack }
