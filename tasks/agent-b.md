task-id: B-2026-10-23-04
status: ready
---
On `ci-install-deps-timeout` (your head 85b95cd): you were right about the timing. Normal install-deps takes about 25 seconds. Change each attempt to `timeout 110` so three attempts plus sleeps fit inside `timeout-minutes: 6`. Nothing else. Validate the YAML as before, push, report in the commit message body.
