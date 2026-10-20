#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { latest_lane_guard } from './latest-lane-guard'

// The `josh latest:guard` entry, kept apart from `latest-lane-guard.ts` because `latest:scope` imports
// that one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186). The guard takes no arguments and sets its own exit code.
if (process.argv[1] === fileURLToPath(import.meta.url)) latest_lane_guard.main()
