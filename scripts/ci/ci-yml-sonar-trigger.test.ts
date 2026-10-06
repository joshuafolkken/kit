import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

// sonar-qube.yml scanned a pull request into any branch while ci.yml runs only for main, so a pull
// request that never ships spent a run and a SonarCloud analysis (joshuafolkken/kit#3326).
const SONAR_YML = '.github/workflows/sonar-qube.yml'
const MAIN_BRANCH = 'main'

describe('sonar-qube.yml triggers', () => {
	it.each(['push', 'pull_request'])('limits %s to main', (event_name) => {
		const trigger = ci_yml_fixture.load_workflow(SONAR_YML).on?.[event_name]

		expect(trigger?.branches).toEqual([MAIN_BRANCH])
	})
})
