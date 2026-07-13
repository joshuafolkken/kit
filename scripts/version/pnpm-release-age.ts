/**
 * Age gate for the `josh latest` pnpm bump (issue #662).
 *
 * `corepack use pnpm@latest-<major>` adopts whatever the per-major dist-tag points to.
 * When kit's maintenance environment does not suppress a just-published pnpm, kit adopts
 * it and consumers sync the `packageManager` pin. Their CI then installs pnpm through
 * `pnpm/action-setup`'s self-installer under safe-chain, which proxies the registry and
 * returns a degraded manifest (`dist.integrity` undefined) for a version still inside the
 * `minimum-release-age` window — the self-installer crashes on the missing integrity.
 *
 * This module decides whether the candidate pnpm is still inside that window and should be
 * HELD this run. The gate is age-driven, so it lifts automatically once the version ages
 * past the window — no hardcoded pin to maintain. Every inability to determine the age
 * (missing file, network failure, unexpected registry shape) fails OPEN so a transient
 * hiccup never freezes pnpm permanently; the existing corepack-level skip still catches
 * versions safe-chain suppresses at resolution time.
 */
import { readFileSync } from 'node:fs'
import { z } from 'zod'

const NPMRC_PATH = '.npmrc'
const REGISTRY_PACKUMENT_URL = 'https://registry.npmjs.org/pnpm'
const MINIMUM_RELEASE_AGE_RE = /^[ \t]*minimum-release-age[ \t]*=[ \t]*(\d+)/mu
const DEFAULT_WINDOW_MINUTES = 1440
const MS_PER_MINUTE = 60_000
const FETCH_TIMEOUT_MS = 10_000

const packument_schema = z.looseObject({
	'dist-tags': z.record(z.string(), z.string()).optional(),
	time: z.record(z.string(), z.string()).optional(),
})

type Packument = z.infer<typeof packument_schema>

interface DistributionTagRelease {
	version: string
	published_at: string
}

interface HoldDecision {
	is_held: boolean
	version?: string
	window_minutes?: number
}

// Parse `minimum-release-age=<minutes>` (safe-chain's suppression window) from an .npmrc,
// falling back to the shipped default when the line is absent or malformed.
function parse_minimum_release_age_minutes(npmrc_content: string): number {
	const raw = MINIMUM_RELEASE_AGE_RE.exec(npmrc_content)?.[1]
	if (raw === undefined) return DEFAULT_WINDOW_MINUTES

	return Number(raw)
}

function read_minimum_release_age_minutes(npmrc_path: string = NPMRC_PATH): number {
	try {
		return parse_minimum_release_age_minutes(readFileSync(npmrc_path, 'utf8'))
	} catch {
		return DEFAULT_WINDOW_MINUTES
	}
}

// Resolve the concrete version behind pnpm@latest-<major> and its ISO publish time from a
// packument. Returns undefined when the dist-tag or its timestamp is missing.
function resolve_distribution_tag_release(
	packument: Packument,
	major: string,
): DistributionTagRelease | undefined {
	const version = packument['dist-tags']?.[`latest-${major}`]
	if (version === undefined) return undefined
	const published_at = packument.time?.[version]
	if (published_at === undefined) return undefined

	return { version, published_at }
}

// Whether a release published at `published_at` is younger than the window as of `now_ms`.
// A malformed timestamp parses to NaN, so the comparison is false — treated as "not too new"
// (fail-open), matching the module's best-effort contract.
function is_release_too_new(published_at: string, now_ms: number, window_minutes: number): boolean {
	const age_minutes = (now_ms - Date.parse(published_at)) / MS_PER_MINUTE

	return age_minutes < window_minutes
}

async function fetch_pnpm_packument(): Promise<Packument | undefined> {
	try {
		const response = await fetch(REGISTRY_PACKUMENT_URL, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		})
		if (!response.ok) return undefined

		return packument_schema.parse(await response.json())
	} catch {
		return undefined
	}
}

// Decide whether `josh latest` should hold the pnpm bump because the candidate version is
// still inside the minimum-release-age window. Fail-open at every uncertain step.
async function resolve_hold_decision(
	major: string | undefined,
	now_ms: number,
): Promise<HoldDecision> {
	if (major === undefined) return { is_held: false }
	const packument = await fetch_pnpm_packument()
	if (packument === undefined) return { is_held: false }
	const release = resolve_distribution_tag_release(packument, major)
	if (release === undefined) return { is_held: false }
	const window_minutes = read_minimum_release_age_minutes()

	return {
		is_held: is_release_too_new(release.published_at, now_ms, window_minutes),
		version: release.version,
		window_minutes,
	}
}

const pnpm_release_age = {
	parse_minimum_release_age_minutes,
	read_minimum_release_age_minutes,
	resolve_distribution_tag_release,
	is_release_too_new,
	fetch_pnpm_packument,
	resolve_hold_decision,
}

export { pnpm_release_age, type HoldDecision, type Packument }
