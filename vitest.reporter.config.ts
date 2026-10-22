import { unit_file_reporter } from '#tools/test/unit-file-reporter'

// The unit suite's reporter as vitest loads it by path (`unit_setup_files.UNIT_FILE_REPORTER`): it
// constructs the module's default export, and `new` on a function returning an object yields that
// object. A file of its own so `vitest.config.ts` names the reporter without importing it — whatever
// the config imports is a config dependency, on whose change `vitest related` runs every test
// (joshuafolkken/kit#4465).
export default unit_file_reporter.create
