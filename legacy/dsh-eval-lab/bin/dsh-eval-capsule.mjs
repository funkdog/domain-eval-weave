#!/usr/bin/env node

import { runCapsuleCli } from "../dist/capsule-cli/index.js";

process.exitCode = await runCapsuleCli(process.argv.slice(2));
