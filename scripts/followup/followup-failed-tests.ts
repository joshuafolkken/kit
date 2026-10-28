import path from 'node:path'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import {
	observation_record,
	REFUSED_VERDICT,
	type ObservationEntry,
} from '#scripts/observations/observation-record'
import { review_comment_round } from '#scripts/review/review-comment-round'
import { vitest_failure_summary } from '#scripts/test/vitest-failure-summary'

// A CI job that ended `failure` because a unit test went red can still owe nothing to the change: a test
// the diff never touched fails under runner load (joshuafolkken/kit#5152, a frame-budget test on a busy
// runner). `followup` reruns such a job once, as it does a stalled one (`followup-job-rerun.ts`), and
// these are the readings that decide it: the failed tests a job's log names, and whether any of them
// belongs to the change.
//
// **A test belongs to the change when its own file or its subject module moved** — `foo.claim.test.ts`
// tests `foo.claim.ts` and `foo.ts`. A test reaching a moved module only through an import is missed,
// and costs one rerun: the second red still stops `followup`, since a rerun attempt is never rerun.

// GitHub Actions stamps every log line `<ISO timestamp> `, which vitest's ` FAIL  ` line does not begin with.
const LOG_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\S+Z /u
const TEST_SUFFIX = /\.test(?<extension>\.[^./]+)$/u
const SEGMENT_SEPARATOR = '.'
const OBSERVATION_SLUG = 'followup-unrelated-test-rerun'
const OBSERVATION_DEPTH = 'd1'
const NAME_SEPARATOR = '; '
const UNNAMED_ISSUE =
	'Did not record the failed tests outside the change: the branch names no issue to post them on.'

const RERUN_VERDICT = 'rerun'
const KEPT_VERDICT = 'kept'
const UNNAMED_VERDICT = 'unnamed'

type TestVerdict = typeof RERUN_VERDICT | typeof KEPT_VERDICT | typeof UNNAMED_VERDICT

interface FailedTests {
	files: ReadonlyArray<string>
	names: ReadonlyArray<string>
}

interface UnrelatedFailure {
	job: string
	tests: FailedTests
}

// The failed tests vitest named in a job's log — empty when the job failed on anything but a test.
function read_failed_tests(log: string): FailedTests {
	const lines = log.split('\n').map((line) => line.replace(LOG_TIMESTAMP, ''))
	const names = vitest_failure_summary.failed_tests(lines.join('\n'))

	return { files: vitest_failure_summary.failed_files(names), names }
}

// The test file itself, then the module each leading run of its name's segments names.
function subjects_of(test_file: string): ReadonlyArray<string> {
	const extension = TEST_SUFFIX.exec(test_file)?.groups?.['extension']

	if (extension === undefined) return [test_file]

	const directory = path.posix.dirname(test_file)
	const segments = path.posix.basename(test_file, `.test${extension}`).split(SEGMENT_SEPARATOR)
	const modules = segments.map((_, index) =>
		path.posix.join(
			directory,
			`${segments.slice(0, index + 1).join(SEGMENT_SEPARATOR)}${extension}`,
		),
	)

	return [test_file, ...modules]
}

function is_in_change(test_file: string, changed: ReadonlySet<string>): boolean {
	return subjects_of(test_file).some((subject) => changed.has(subject))
}

// **`rerun` only when the log named a failed test and none of them belongs to the change**, `kept`
// when one does. A job red with no test named — a lint, a build, a job gathering others' results — is
// `unnamed`: rerun only as one waiting on a job red on tests outside the change (`followup-job-needs.ts`).
function verdict_of(tests: FailedTests, changed: ReadonlySet<string>): TestVerdict {
	if (tests.files.length === 0) return UNNAMED_VERDICT

	return tests.files.every((file) => !is_in_change(file, changed)) ? RERUN_VERDICT : KEPT_VERDICT
}

// The ledger line a rerun leaves, so a test that keeps failing beside unrelated changes is counted
// rather than retried into silence. A ledger line's fields are split on ` | `, so the `|<project>|`
// prefix a workspace test name carries is rewritten.
function observation_of(failures: ReadonlyArray<UnrelatedFailure>): ObservationEntry {
	const files = new Set(failures.flatMap(({ tests }) => tests.files))
	const names = new Set(failures.flatMap(({ tests }) => tests.names))
	const listed = [...names].map((name) => name.replaceAll('|', '/'))
	const jobs = failures.map(({ job }) => job)

	return {
		slug: OBSERVATION_SLUG,
		depth: OBSERVATION_DEPTH,
		where: [...files].join(', '),
		what: `followup reran ${jobs.join(', ')}; failed outside the change: ${listed.join(NAME_SEPARATOR)}`,
	}
}

// **The line is posted on the issue, never appended to the tree** (joshuafolkken/kit#5197): the rerun
// happens during the CI wait, after `prepare_merge` committed the ledger, so an appended line would
// either be lost with the lane or need a push of its own that restarts CI. `review-comment-round.ts`
// carries it into the ledger once the issue closes; the count is still read off this tree's ledger.
async function post(entry: ObservationEntry, issue: number): Promise<string> {
	const assessment = await observation_record.assess({
		entry,
		checkout: observation_ledger_home.ledger_root(),
		now: new Date(),
	})

	if (assessment.verdict === REFUSED_VERDICT) return `${REFUSED_VERDICT}: ${assessment.reason}`

	await git_gh_issue_write.issue_comment(
		String(issue),
		review_comment_round.observation_body_of([assessment.line]),
	)

	return assessment.verdict
}

// A post that fails is reported and does not stop the step it describes; a branch naming no issue has
// nowhere to post.
async function record_entry(entry: ObservationEntry, issue: number | undefined): Promise<void> {
	if (issue === undefined) {
		console.info(`⚠️ ${UNNAMED_ISSUE}`)

		return
	}

	try {
		console.info(`📝 Recorded the ${entry.slug} observation: ${await post(entry, issue)}`)
	} catch (error) {
		console.info(`⚠️ Could not record the ${entry.slug} observation: ${String(error)}`)
	}
}

async function record(
	failures: ReadonlyArray<UnrelatedFailure>,
	issue: number | undefined,
): Promise<void> {
	if (failures.length === 0) return

	await record_entry(observation_of(failures), issue)
}

const followup_failed_tests = {
	observation_of,
	read_failed_tests,
	record,
	record_entry,
	subjects_of,
	verdict_of,
}

export type { FailedTests, TestVerdict, UnrelatedFailure }
export { followup_failed_tests, KEPT_VERDICT, OBSERVATION_SLUG, RERUN_VERDICT, UNNAMED_VERDICT }
