---
name: smm-test
description: Run SMM tests with proper exclusions for long-running integration tests. Optionally target a specific test file.
---

# Run SMM tests

Runs the vitest test suite with standard exclusions for auth flow, API routes, story flow, and survey tests that require external setup.

## Usage

**Run all tests (excluding slow integration tests):**
```
cd /root/smm; timeout 240 npx vitest run --exclude='**/auth_flow.test.ts' --exclude='**/api_routes_new.test.ts' --exclude='**/STORY_FLOW.test.ts' --exclude='**/BUSINESS_SURVEY_REAL.test.ts' --exclude='**/SURVEY_FLOW.test.ts' --exclude='**/SOCIAL_PUBLISHING.test.ts' --exclude='**/E2E_ANALYTICS.test.ts' --exclude='**/E2E_ANALYTICS_WEBHOOK.test.ts'
```

**Run a specific test file:**
```
cd /root/smm; timeout 120 npx vitest run $TEST_FILE_PATH
```

**Run tests in watch mode:**
```
cd /root/smm; npx vitest --exclude='**/auth_flow.test.ts' --exclude='**/api_routes_new.test.ts'
```

## Notes

- Tests run on the host, not inside the container.
- Some tests require the Docker container to be running (integration tests).
- Use `timeout` to prevent hung test processes from blocking.
- Check for zombie vitest processes with `ps aux | grep [v]itest` and kill with `kill -9 $PID`.