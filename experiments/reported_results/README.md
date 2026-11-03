# Reported matching experiment results

This directory is a Git-tracked snapshot of `experiments/results/`, which is
ignored by Git. Keep `experiments/results/` as the local working output and this
directory as the canonical copy for reports and review.

Snapshot date: `2026-10-21`.

## Contents

- Each run directory contains the original `metrics.json`, `summary.csv`,
  `per_task.csv`, `run_config.json`, `errors.json`, and `STALE.json` when present.
- Raw `rankings.jsonl` is stored as `rankings.jsonl.gz` to keep the repository
  small.
- `manifest.json` records source sizes and SHA-256 hashes for every archived file.
- Directories with `STALE.json` are historical and must not be mixed with current
  results in one table or aggregate. See `../README.md` for supersession details.

## Current runs

- `synthetic_v2_full_seed42_hashing`
- `synthetic_v2_30_all_methods`

## Restore a rankings file

```bash
gzip -dk experiments/reported_results/synthetic_v2_full_seed42_hashing/rankings.jsonl.gz
```

## Refresh the snapshot

```bash
python experiments/archive_results.py
```

The script replaces each run directory under `experiments/reported_results/` and
rewrites `manifest.json`. It does not modify `experiments/results/`.
