# Ollama memory-usage audit

Audit date: 2026-10-21

## Findings

The configured models are `qwen3:4b` (Q4_K_M, 2,497,293,931 bytes / 2.326 GiB
on disk) and `qwen3-embedding:0.6b` (Q8_0, 639,150,858 bytes / 0.595 GiB on
disk). These are Ollama model-file sizes, not measurements of resident inference
memory.

The effective settings read during the audit were `OLLAMA_KEEP_ALIVE=0` and
`OLLAMA_NUM_CTX=4096`. The chat provider, matching analysis and explanation
requests, and embedding requests use the configured keep-alive setting. The
embedding preparation command previously overrode it with `5m`; that override
has been removed so that command now follows the configured policy as well.
`keep_alive=0` unloads a model after a completed request; it is not a memory cap
and does not prevent temporary inference allocations or overlapping requests.

## Top-3 matching inference path

For draft recommendations, `DraftCandidatesView` delegates to
`recommend_for_draft`. Requirements are extracted with the chat model, then
deterministic scoring and eligibility filtering run before embedding inference.
If no candidate is eligible, no embedding request is made. If at least one is
eligible, one batched embedding request is made for the task text and any
uncached employee-experience texts. Employee vectors may be reused from cache;
the task vector is still requested for that matching operation. The resulting
similarity contributes to semantic reranking before the top three are selected.
If embeddings are unavailable, matching returns the deterministic ranking
instead. Chat explanations are then requested for up to those three candidates.

## RAM measurements

At the audit snapshot, Windows reported 15.36 GiB total physical memory, 13.77
GiB used, and 1.58 GiB free. Ollama's read-only running-model endpoint listed
no loaded models at that time. Therefore, no chat or embedding inference RAM
measurement was obtained. The measured host usage includes the current
development environment and is not an isolated application measurement.

## Planning estimates (not measurements)

These estimates use the observed model-file sizes as a starting point, with
explicit allowances for the Ollama runner, context/KV cache, and process
workspace. Actual use depends on the Ollama backend, concurrency, and runtime
configuration.

| Scenario | Estimated budget |
| --- | --- |
| 16 GiB development host, current measured baseline | 13.77 GiB used before inference; only 1.58 GiB free while both models are unloaded. |
| Development host during embedding inference | Roughly 14.6–15.0 GiB total use, assuming 0.8–1.2 GiB for the embedding model and runner on top of the measured baseline. This leaves little headroom. |
| Development host during chat inference | Roughly 16.6–17.6 GiB total use, assuming 2.8–3.8 GiB for chat weights, runner, and 4096-token context on top of the measured baseline. This exceeds the observed 15.36 GiB physical total and risks paging or memory pressure. |
| 8 GiB headless deployment | Planning allowance of 2–4 GiB for OS/container runtime, database, API, and web services, plus roughly 2.8–3.8 GiB for chat inference: about 4.8–7.8 GiB at peak before additional safety margin. The embedding peak is estimated at 0.8–1.2 GiB instead of the chat peak when requests are sequential. |

The 8 GiB target is plausible only for a light, low-concurrency deployment with
carefully limited service workers and monitoring; the high end leaves almost no
reserve. `keep_alive=0` helps release idle model allocations but does not make
8 GiB safe for concurrent inference. A 16 GiB deployment or greater is the
safer starting point for sustained or concurrent use. Neither deployment
profile was measured in this environment.

## Verification and limitations

- Mocked request checks passed: chat and embedding payloads both sent
  `keep_alive=0`; chat sent `num_ctx=4096`; embedding inputs were batched.
- `matching.test_experiments`: 36 passed using a database-free unittest run.
- Frontend tests: 34 passed across 6 test files.
- Frontend production build succeeded. Vite warned that the main minified
  JavaScript chunk exceeds 500 kB.
- Focused ESLint for `AssistantPanel`, matching components, matching types, and
  matching presentation utilities passed. Including the existing working-tree
  `Matching.tsx` produces 11 errors and 1 warning in that page.
- `git diff --check` also reports pre-existing trailing whitespace in
  `frontend/src/pages/MyWorkspace.tsx` at line 253; the remaining output is
  Windows line-ending notices on already modified files.
- The database-backed `assistant.tests` and `matching.tests` were not run:
  their normal Django test lifecycle may create a test database, run migrations,
  and create task/membership fixtures, which are disallowed for this audit.
  No database was accessed.
- Browser smoke testing was attempted at `http://127.0.0.1:5173` but the browser
  connection was refused, so it remains unverified.
