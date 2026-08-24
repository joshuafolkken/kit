import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { describe, expect, it } from 'vitest'
import { managed_marker_logic } from './managed-marker-logic'

// The auto-merge workflow has to tell a bump kit will overwrite from one the consumer owns, and
// until joshuafolkken/kit#844 it did so from a hardcoded list of five paths. A list can only speak
// for the package that holds it: a consumer of a consumer receives `ci.yml` from kit and its own
// workflows from the package built on kit, neither distributor knows the other's set, and whichever
// `sync` ran last would decide a shared list. The stamp moves the answer onto the file being asked
// about, where it cannot drift and where every tier can add its own.
const { MARKER_TOKEN, MARKER_PREFIX, is_marked, apply_marker_for_destination } =
	managed_marker_logic

const WORKFLOW_DESTINATION = '.github/workflows/ci.yml'
const NESTED_WORKFLOW_DESTINATION = 'consumer/.github/workflows/production.yml'
const PROMPT_DESTINATION = 'CLAUDE.md'
const WORKFLOW_BODY = 'name: CI\non: push\n'
const DOWNSTREAM_PACKAGE = '@joshuafolkken/app-kit'

function stamped(destination: string, text: string): string {
	return apply_marker_for_destination(destination, text, KIT_PACKAGE_NAME)
}

describe('managed-marker-logic — what gets stamped', () => {
	it.each([WORKFLOW_DESTINATION, NESTED_WORKFLOW_DESTINATION])(
		'stamps the workflow destination %s',
		(destination) => {
			expect(is_marked(stamped(destination, WORKFLOW_BODY))).toBe(true)
		},
	)

	// Only workflows are asked about. Stamping anything else would put a YAML comment into files
	// that are not YAML, and nothing reads it there.
	it('leaves a non-workflow destination untouched', () => {
		expect(stamped(PROMPT_DESTINATION, WORKFLOW_BODY)).toBe(WORKFLOW_BODY)
	})

	it('keeps the original content below the stamp', () => {
		expect(stamped(WORKFLOW_DESTINATION, WORKFLOW_BODY)).toContain(WORKFLOW_BODY)
	})

	// The consumer reads the stamp to find out which package to edit instead of the file.
	it('names the package that writes the file', () => {
		expect(stamped(WORKFLOW_DESTINATION, WORKFLOW_BODY)).toContain(
			`${MARKER_PREFIX} ${KIT_PACKAGE_NAME}`,
		)
	})

	// The reason the module is exported rather than kept internal: a package built on kit distributes
	// its own workflows and has to stamp them as its own. Re-implementing the header downstream is
	// what the export exists to prevent — a second spelling of the token silently breaks the check
	// (joshuafolkken/kit#844).
	it('stamps a downstream distributor’s file with that distributor’s name', () => {
		const written = apply_marker_for_destination(
			WORKFLOW_DESTINATION,
			WORKFLOW_BODY,
			DOWNSTREAM_PACKAGE,
		)

		expect(written).toContain(`${MARKER_PREFIX} ${DOWNSTREAM_PACKAGE}`)
		expect(written).not.toContain(KIT_PACKAGE_NAME)
		expect(is_marked(written)).toBe(true)
	})
})

describe('managed-marker-logic — recognizing a stamp', () => {
	// `josh sync` rewrites each file from the template, so the source never arrives stamped — but a
	// second pass over an already-written file must not stack a second header.
	it('does not stamp text that is already stamped', () => {
		const once = stamped(WORKFLOW_DESTINATION, WORKFLOW_BODY)

		expect(stamped(WORKFLOW_DESTINATION, once)).toBe(once)
	})

	// The regression that makes the first-line rule necessary: the auto-merge workflow declares the
	// token in its own `env` so its shell can match on it. Recognizing the token anywhere would read
	// that template as already stamped and skip it — leaving the one file that performs the check
	// unmarked, and so merging its own bumps.
	it('does not mistake a file that merely mentions the token for a stamped one', () => {
		const mentions = `name: Dependabot auto-merge\nenv:\n  MARKER: '${MARKER_PREFIX}'\n`

		expect(is_marked(mentions)).toBe(false)
		expect(is_marked(stamped(WORKFLOW_DESTINATION, mentions))).toBe(true)
	})

	it('recognizes a stamp only on the first line', () => {
		expect(is_marked(`name: CI\n${MARKER_PREFIX} ${KIT_PACKAGE_NAME}\n`)).toBe(false)
	})

	// The workflow's shell matches this exact prefix, so the two spellings have to agree.
	it('builds the prefix from the token', () => {
		expect(MARKER_PREFIX).toBe(`# ${MARKER_TOKEN}`)
	})
})
