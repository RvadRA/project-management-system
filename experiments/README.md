# Matching experiments

All runs in this directory are synthetic, file-based experiments. They do not
write to PostgreSQL and do not use production scoring.

## Where results live

- `experiments/results/` is the local working directory and is ignored by Git.
- `experiments/reported_results/` is the Git-tracked snapshot for reports and
  review. It contains all artifacts, with `rankings.jsonl` gzipped, plus a
  SHA-256 manifest.
- Refresh the tracked snapshot after a run:

```bash
python experiments/archive_results.py
```

## Current dataset

- Fixture: `matching/experiments/fixtures/synthetic_v2_seed42/`
- Dataset version: `synthetic-v2`
- Seed: `42`
- Target policy: qualified by skills level 2+ and availability > 0, then sampled
  from an independent hidden synthetic label profile (top-5; ambiguous scenarios
  use a uniform choice from the hidden top-3).
- Hidden label profiles are intentionally not serialized.

Synthetic labels are not objective ground truth. Metrics measure agreement with
the synthetic target process only and must not be presented as real-world
assignment quality.

## Current results

Commands used:

```bash
python manage.py run_matching_experiment \
  --dataset matching/experiments/fixtures/synthetic_v2_seed42 \
  --methods rule,embedding,hybrid,random,popularity \
  --output-dir experiments/results \
  --run-id synthetic_v2_full_seed42_hashing

python manage.py run_matching_experiment \
  --dataset matching/experiments/fixtures/synthetic_v2_seed42 \
  --methods rule,embedding,hybrid,random,popularity,direct_llm \
  --limit 30 --output-dir experiments/results \
  --run-id synthetic_v2_30_all_methods
```

Full 300-task run, 290 target tasks and 10 no-target tasks:

| Method | Top-1 | Top-3 | MRR | NDCG@3 |
| --- | ---: | ---: | ---: | ---: |
| rule | 0.3069 | 0.7690 | 0.5504 | 0.5673 |
| hybrid | 0.2897 | 0.7517 | 0.5414 | 0.5536 |
| embedding | 0.2552 | 0.6793 | 0.5036 | 0.4943 |
| popularity | 0.2552 | 0.6483 | 0.4982 | 0.4766 |
| random | 0.2207 | 0.6862 | 0.4901 | 0.4878 |

30-task sample, 29 target tasks and 1 no-target task:

| Method | Top-1 | Top-3 | MRR | NDCG@3 |
| --- | ---: | ---: | ---: | ---: |
| direct_llm (qwen3:4b) | 0.3448 | 0.7241 | 0.5730 | 0.5616 |
| rule | 0.3103 | 0.7586 | 0.5759 | 0.5796 |
| hybrid | 0.3103 | 0.8621 | 0.5828 | 0.6314 |
| embedding | 0.3103 | 0.7241 | 0.5362 | 0.5398 |
| random | 0.1724 | 0.6897 | 0.4517 | 0.4581 |
| popularity | 0.1724 | 0.6897 | 0.4443 | 0.4536 |

The 30-task sample is deterministic but not stratified; it happens to contain no
`high_load` task. Direct LLM results are not expected to be bit-for-bit stable
across repeated runs.

## Stale results

Every older result directory has `STALE.json`. These runs used the legacy v1
fixture and/or the pre-fix availability policy and are not comparable with v2.

| Run | Superseded by |
| --- | --- |
| `smoke_rule2` | no direct replacement; historical smoke check |
| `smoke_rule3` | no direct replacement; historical smoke check |
| `synthetic_full_seed42_hashing` | `synthetic_v2_full_seed42_hashing` |
| `synthetic_baselines30_hashing` | `synthetic_v2_30_all_methods` |
| `synthetic_30_all_methods` | `synthetic_v2_30_all_methods` |
| `synthetic_direct_llm30_qwen3_4b` | `synthetic_v2_30_all_methods` |
| `synthetic_embedding30_ollama` | `synthetic_v2_30_all_methods` |

Do not mix stale and current rows in one table or aggregate. Direct LLM runs are
limited to the 30-task sample unless a separate approval is given.
