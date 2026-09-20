import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { decision_oracle } from '#scripts/rules/decision-oracle'
import { describe, expect, it } from 'vitest'
import {
	DEFER_BRANCH,
	EXCLUDED_BRANCH,
	FIX_BRANCH,
	HOTSPOT_BRANCHES,
	LOCAL_BRANCH,
	sonar_hotspots,
	UNREADABLE,
	type Hotspot,
	type HotspotDisposition,
	type HotspotFetch,
} from './sonar-hotspots'
import { sonar_hotspots_cli } from './sonar-hotspots-cli'

const COMMAND = 'sonar:hotspots'
const SCRIPT_PATH = 'scripts/sonar/sonar-hotspots-cli.ts'
const ALIAS = 'shs'
const MANAGED_PREFIX = 'managed:'
const TO_REVIEW = 'TO_REVIEW'
const REVIEWED = 'REVIEWED'
const TMP_PREFIX = 'sonar-'
const PROPERTIES_NAME = 'sonar-project.properties'

function captured_lines(disposition: HotspotDisposition): Array<string> {
	const lines: Array<string> = []
	const original = console.info

	console.info = (line: unknown) => {
		lines.push(String(line))
	}

	try {
		sonar_hotspots_cli.print_disposition(disposition)
	} finally {
		console.info = original
	}

	return lines
}

function read_key_from_properties(contents: string): string | undefined {
	const directory = mkdtempSync(path.join(tmpdir(), TMP_PREFIX))

	try {
		writeFileSync(path.join(directory, PROPERTIES_NAME), contents)

		return sonar_hotspots_cli.read_project_key(directory)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

function hotspot(overrides: Partial<Hotspot>): Hotspot {
	return {
		key: 'k1',
		status: TO_REVIEW,
		component: 'local:scripts/a.ts',
		ruleKey: 'S4036',
		...overrides,
	}
}

function is_managed(component: string): boolean {
	return component.startsWith(MANAGED_PREFIX)
}

describe('sonar_hotspots.classify_hotspot', () => {
	const to_review = hotspot({ status: TO_REVIEW })

	it('excludes a to-review hotspot on an upstream-synced path', () => {
		expect(sonar_hotspots.classify_hotspot(to_review, true)).toBe(EXCLUDED_BRANCH)
	})

	it('marks a to-review hotspot on project-local code as local', () => {
		expect(sonar_hotspots.classify_hotspot(to_review, false)).toBe(LOCAL_BRANCH)
	})

	it('reads a reviewed-and-fixed hotspot as a fix', () => {
		const reviewed = hotspot({ status: REVIEWED, resolution: 'FIXED' })

		expect(sonar_hotspots.classify_hotspot(reviewed, false)).toBe(FIX_BRANCH)
	})

	it('defers a reviewed hotspot that was set aside', () => {
		const reviewed = hotspot({ status: REVIEWED, resolution: 'SAFE' })

		expect(sonar_hotspots.classify_hotspot(reviewed, false)).toBe(DEFER_BRANCH)
	})
})

describe('sonar_hotspots.classify_fetch', () => {
	it('converts a response into all four branches', () => {
		const fetched: HotspotFetch = {
			hotspots: [
				hotspot({ component: `${MANAGED_PREFIX}a.ts`, status: TO_REVIEW }),
				hotspot({ component: 'local:b.ts', status: TO_REVIEW }),
				hotspot({ component: 'local:c.ts', status: REVIEWED, resolution: 'FIXED' }),
				hotspot({ component: 'local:d.ts', status: REVIEWED, resolution: 'SAFE' }),
			],
		}

		const result = sonar_hotspots.classify_fetch(fetched, is_managed)
		const branches = 'classified' in result ? result.classified.map((entry) => entry.branch) : []

		expect(branches).toEqual([EXCLUDED_BRANCH, LOCAL_BRANCH, FIX_BRANCH, DEFER_BRANCH])
	})

	it('reports an unreadable fetch rather than an empty success', () => {
		const result = sonar_hotspots.classify_fetch({ error: 'HTTP 429' }, is_managed)

		expect(result).toEqual({ unreadable: 'HTTP 429' })
	})

	it('classifies an empty success as no hotspots, distinct from unreadable', () => {
		const result = sonar_hotspots.classify_fetch({ hotspots: [] }, is_managed)

		expect(result).toEqual({ classified: [] })
	})
})

describe('sonar_hotspots.component_path', () => {
	const bare_path = 'scripts/a.ts'

	it('strips the SonarCloud project-key prefix', () => {
		expect(sonar_hotspots.component_path(`joshuafolkken_kit:${bare_path}`)).toBe(bare_path)
	})

	it('returns a bare path unchanged', () => {
		expect(sonar_hotspots.component_path(bare_path)).toBe(bare_path)
	})
})

describe('sonar_hotspots_cli.format_hotspot', () => {
	it('carries the line and the branch', () => {
		const line = sonar_hotspots_cli.format_hotspot({
			hotspot: hotspot({ line: 12 }),
			branch: EXCLUDED_BRANCH,
		})

		expect(line).toContain('12')
		expect(line).toContain(EXCLUDED_BRANCH)
	})

	it('renders a missing line as a placeholder', () => {
		const line = sonar_hotspots_cli.format_hotspot({ hotspot: hotspot({}), branch: LOCAL_BRANCH })

		expect(line).toContain('?')
	})
})

describe('sonar_hotspots_cli.print_disposition', () => {
	it('prints the unreadable marker for a failed read', () => {
		expect(captured_lines({ unreadable: 'HTTP 429' }).join('\n')).toContain(UNREADABLE)
	})

	it('says so plainly when a success found no hotspots', () => {
		expect(captured_lines({ classified: [] }).join('\n')).toContain('no hotspots')
	})

	it('prints one line per classified hotspot', () => {
		const lines = captured_lines({ classified: [{ hotspot: hotspot({}), branch: FIX_BRANCH }] })

		expect(lines).toHaveLength(1)
	})
})

describe('sonar_hotspots_cli.read_project_key', () => {
	it('reads the project key from the properties file', () => {
		expect(read_key_from_properties('sonar.projectKey=demo_key\n')).toBe('demo_key')
	})

	it('returns undefined when no project key line is present', () => {
		expect(read_key_from_properties('sonar.organization=x\n')).toBeUndefined()
	})
})

describe('sonar:hotspots registration', () => {
	it('is on the command map', () => {
		expect(COMMAND_MAP[COMMAND]?.script).toBe(SCRIPT_PATH)
	})

	it('is reachable by its alias', () => {
		expect(ALIASES[ALIAS]).toBe(COMMAND)
	})

	it('states the pull-request positional in its usage line', () => {
		expect(sonar_hotspots_cli.USAGE).toContain('<PR>')
	})
})

describe('sonar:hotspots decision oracle', () => {
	const oracle = decision_oracle.find_oracle(COMMAND)

	it('is registered as an oracle', () => {
		expect(oracle).toBeDefined()
	})

	it('declares every branch the code can produce, and the unreadable marker', () => {
		for (const branch of [...HOTSPOT_BRANCHES, UNREADABLE]) {
			expect(oracle?.vocabulary).toContain(branch)
		}
	})
})
