# ProJectMS read-only load test

This Locust profile exercises authenticated read-only API lists. It does not
create or update tasks, assignments, project memberships, or other records, and
does not call Ollama, faster-whisper, or other AI endpoints.

Do not run it until the target owner confirms the deployment is isolated, uses
the dedicated test database, and is approved for the selected load. Never point
it at production or an unverified host. A dedicated test account and a valid
access token must be provided outside the repository.

## Guarded setup (PowerShell)

Locust is intentionally not added as a project dependency. Install/use it only
in an approved test environment. The script will refuse to start unless all
guard variables are set and the CLI host exactly matches the approved origin.
The pre-issued access token must remain valid for the whole stage; do not enable
refresh-token rotation in this read-only profile.

```powershell
$env:LOADTEST_ENVIRONMENT = 'isolated-test'
$env:LOADTEST_APPROVED_HOST = 'http://127.0.0.1:8000'
$env:LOADTEST_ACCESS_TOKEN = '<short-lived token for a dedicated test user>'
$env:LOADTEST_TEST_PROJECT_ID = '<id from the isolated synthetic fixture>'
$env:LOADTEST_CONFIRM_ISOLATED_DATABASE = 'YES'
```

The test profile rotates through paginated, read-only list endpoints:

- `/api/projects/list/`
- `/api/projects/blocks/`
- `/api/projects/tasks/`
- `/api/workflows/processes/`
- `/api/workflows/tasks/`
- `/api/matching/skills/`
- `/api/projects/tasks/?project_id=<test project>&page=1` (filter)
- `/api/projects/knowledge-materials/?scope=global&search=loadtest&page=1`
  (search)

## Staged profile (do not skip between levels)

Run one profile at a time, inspect application and database telemetry, and get
approval before increasing the load. These are proposed durations, not measured
capacity claims:

1. Warm-up: 1 user, spawn 1/s, 5 minutes.
2. 25 users: spawn 1/s, hold 10 minutes.
3. 100 users: spawn 2/s, hold 15 minutes.
4. 500 users: spawn 5/s, hold 20 minutes, only after the prior level passes
   and the environment owner explicitly approves the next step.

Example for the first stage:

```powershell
locust -f experiments/loadtest/locustfile.py --headless `
  --host $env:LOADTEST_APPROVED_HOST -u 1 -r 1 --run-time 5m `
  --csv experiments/loadtest/results/warmup
```

Change `-u`, `-r`, `--run-time`, and the CSV prefix only for the separately
approved next stage. Preserve each stage's CSV output.

## Measurements and provisional stop conditions

Record Locust throughput, p50/p95/p99 latency, HTTP errors, and timeouts. Collect
CPU, RAM, network, worker/process counts, PostgreSQL active/total connections,
and database query latency from the isolated test host using its approved
monitoring tools. Do not query a production database for test telemetry.

Before the run, agree on numeric pass/fail SLOs. Provisional safety stops are:

- stop if HTTP 5xx/timeouts exceed 1% for 60 seconds;
- stop if p95 exceeds the agreed endpoint SLO for 3 minutes;
- stop if CPU or memory stays above 85% for 3 minutes;
- stop if PostgreSQL connections reach 80% of the configured maximum or show
  sustained queueing.

These limits are conservative proposals and require confirmation against the
test host's actual capacity. This profile excludes login traffic (use dedicated
pre-issued test tokens), writes, file uploads, search-heavy queries, and AI
inference. Exercise AI separately with a small concurrency cap after its own
explicit approval.
