# Running the project with old and new data

This guide shows how to run the project against:

- **Old development data:** `pms_db`
- **New synthetic-v2 data:** `pms_synthv2_test`

Both databases already exist in the local PostgreSQL instance. You do **not** need to import, seed, or migrate anything just to start the application.

All commands below assume you are in the repository root and the Python virtual environment is activated.

---

## Quick start: old data (usual flow)

Terminal 1:

```bash
cd frontend
npm run dev
```

Terminal 2:

```bash
source venv/Scripts/activate
python manage.py runserver
```

Select the database for your local environment with the `DB_NAME` variable.

Set `VITE_API_URL` in your local frontend environment to the backend URL you are using.

---

## 1. Current data state

| Dataset | Database | Users | Profiles | Projects | Tasks | Workloads | Participations | Unavailability |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Old development data | `pms_db` | 20 | 19 | 16 | 65 | 14 | 3 | 0 |
| Synthetic-v2 | `pms_synthv2_test` | 31 | 30 | 55 | 726 | 46 | 128 | 31 |

Notes:

- The synthetic-v2 database contains 300 target tasks and 426 history tasks.
- Synthetic target deadlines are shifted **+12 months** and fall in `2027-01-14 … 2027-07-23`.
- Synthetic users are named `synthv2_manager` and `synthv2_e01` … `synthv2_e30`.
- `synthv2_manager` is an `ADMIN` user without an employee profile. It is excluded from candidate ranking.
- The synthetic fixture used deterministic hashing vectors, not Ollama embeddings. See `matching/experiments/fixtures/synthetic_v2_seed42/manifest.json`.
- Keep import manifests and database backups in your local `backups/` directory; do not commit them.

### Migration state

- `pms_db` is fully migrated.
- `pms_synthv2_test` has one pending migration: `token_blacklist.0013_alter_blacklistedtoken_options_and_more`.

The application can be started without applying that migration, but `migrate --check` will exit with code `1` for the synthetic database. If you decide to apply it, make a backup first:

```bash
pg_dump -Fc -h localhost -U "$DB_USER" -d pms_synthv2_test \
  -f backups/pms_synthv2_test_before_migrate.dump

DB_NAME=pms_synthv2_test python manage.py migrate
```

Only do this if you accept the schema change.

---

## 2. How the database is selected

Database settings are read from environment variables in `config/settings.py`:

| Variable | Default |
|---|---|
| `DB_NAME` | `pms_db` |
| `DB_USER` | `postgres` |
| `DB_PASSWORD` | Set in your local environment |
| `DB_HOST` | `localhost` |
| `DB_PORT` | `5432` |

Do not commit `.env`; it contains local configuration and may contain secrets.

`config/env.py` loads `.env` with `os.environ.setdefault(...)`, so an environment variable set in the shell **overrides** `.env`. This is why the commands below use inline `DB_NAME=...` values.

The frontend reads `VITE_API_URL` from `frontend/.env.local`. Set it to the address of the backend you are running, for example:

```text
VITE_API_URL=http://localhost:8000/api
```

Override `VITE_API_URL` when starting the frontend if you want it to talk to a different backend.

---

## 3. Prerequisites

Start PostgreSQL and Redis. For example:

```bash
pg_isready -h localhost -p 5432
redis-cli ping
```

If you use Docker for PostgreSQL:

```bash
docker-compose up -d
```

> The Docker Compose service creates only the development database. It does not create `pms_synthv2_test`. Configure database credentials in your local `.env` and do not commit that file.

Activate the Python environment and verify the project:

```bash
source venv/Scripts/activate
python manage.py check
```

Install frontend dependencies if `frontend/node_modules` is missing:

```bash
cd frontend
npm install
```

---

## 4. Run old and new data side by side (recommended)

Use four terminals.

### Terminal 1 — backend with old data

```bash
source venv/Scripts/activate
DB_NAME=pms_db python manage.py runserver 8000
```

### Terminal 2 — backend with synthetic-v2 data

```bash
source venv/Scripts/activate
DB_NAME=pms_synthv2_test python manage.py runserver 8001
```

### Terminal 3 — frontend for old data

```bash
cd frontend
VITE_API_URL=http://localhost:8000/api npm run dev -- --port 5173
```

### Terminal 4 — frontend for synthetic-v2 data

```bash
cd frontend
VITE_API_URL=http://localhost:8001/api npm run dev -- --port 5174
```

Open:

| Dataset | Frontend | Backend API |
|---|---|---|
| Old data | http://localhost:5173 | http://localhost:8000/api/ |
| Synthetic-v2 | http://localhost:5174 | http://localhost:8001/api/ |

The current CORS configuration allows ports `5173`, `5174`, and `5175`.

### PowerShell equivalents

```powershell
$env:DB_NAME="pms_db"; python manage.py runserver 8000
```

```powershell
$env:DB_NAME="pms_synthv2_test"; python manage.py runserver 8001
```

```powershell
cd frontend
$env:VITE_API_URL="http://localhost:8000/api"; npm run dev -- --port 5173
```

```powershell
cd frontend
$env:VITE_API_URL="http://localhost:8001/api"; npm run dev -- --port 5174
```

PowerShell environment variables persist for the current session. Reset them with:

```powershell
Remove-Item Env:DB_NAME
Remove-Item Env:VITE_API_URL
```

---

## 5. Run only one dataset at a time

### Old data

Terminal 1:

```bash
cd frontend
npm run dev
```

Terminal 2:

```bash
source venv/Scripts/activate
python manage.py runserver
```

`.env` already selects `DB_NAME=pms_db`. If the frontend still calls port `8001`, update `frontend/.env.local` to `http://localhost:8000/api`.

### Synthetic-v2 data

```bash
source venv/Scripts/activate
DB_NAME=pms_synthv2_test python manage.py runserver
```

In another terminal:

```bash
cd frontend
VITE_API_URL=http://localhost:8001/api npm run dev
```

You can also edit `DB_NAME` in `.env` instead of using inline variables, but restart the backend after changing it.

---

## 6. Verify which database is active

```bash
DB_NAME=pms_synthv2_test python manage.py shell -c \
  "from django.conf import settings; print(settings.DATABASES['default']['NAME'])"
```

Expected output:

```text
pms_synthv2_test
```

To verify the main record counts:

```bash
DB_NAME=pms_synthv2_test python manage.py shell -c \
  "from accounts.models import CustomUser; from matching.models import EmployeeProfile, WorkloadEntry, ProjectParticipation, EmployeeUnavailability; from projects.models import Project; from workflows.models import WorkflowTask; print('users', CustomUser.objects.count(), 'profiles', EmployeeProfile.objects.count(), 'projects', Project.objects.count(), 'tasks', WorkflowTask.objects.count(), 'workloads', WorkloadEntry.objects.count(), 'participations', ProjectParticipation.objects.count(), 'unavailability', EmployeeUnavailability.objects.count())"
```

Expected for `pms_synthv2_test`:

```text
users 31 profiles 30 projects 55 tasks 726 workloads 46 participations 128 unavailability 31
```

Expected for `pms_db`:

```text
users 20 profiles 19 projects 16 tasks 65 workloads 14 participations 3 unavailability 0
```

---

## 7. Login

Do not store or share database account passwords in this guide. Configure credentials locally. Synthetic users require a password to be set in your local database before login:

```bash
DB_NAME=pms_synthv2_test python manage.py changepassword synthv2_manager
```

For an employee account:

```bash
DB_NAME=pms_synthv2_test python manage.py changepassword synthv2_e01
```

This changes only the selected synthetic database. Use the same command with the appropriate database and username when setting up a local account.

`synthv2_manager` is useful for administration, but it has no employee profile and will not appear as a draft candidate. Use an employee account such as `synthv2_e01` when testing the employee view.

---

## 8. Optional services

### Celery

Celery is not required for basic UI/API testing. If you need background jobs or notifications, start a worker with the same `DB_NAME` as the backend:

```bash
DB_NAME=pms_db celery -A config worker -l info -P eventlet
```

```bash
DB_NAME=pms_synthv2_test celery -A config worker -l info -P eventlet
```

Start only one worker at a time unless you intentionally want both databases processed.

### Ollama

The AI assistant uses only the local Ollama model `OLLAMA_CHAT_MODEL=qwen3:4b`; there is no external API fallback. A transient timeout or connection failure is retried once inside the provider (`OLLAMA_CHAT_RETRIES=1`, `OLLAMA_RETRY_BACKOFF=1`). The UI always shows `Ollama · qwen3:4b`.

For 16 GB developer machines the default is `OLLAMA_KEEP_ALIVE=0`: the chat model unloads after each response, so the next request may need to reload it. Set `OLLAMA_KEEP_ALIVE=5m` only when faster repeat requests matter more than RAM. Chat requests use `OLLAMA_NUM_CTX=4096`; this is a context limit, not a hard memory cap.

```bash
ollama serve
ollama pull qwen3:4b
ollama pull qwen3-embedding:0.6b
```

Task-draft parsing and knowledge-base answers use Ollama. The Top-3 recommendation flow also uses Ollama for task analysis and embeddings; if it is unavailable, candidates are still returned using deterministic scoring and explanations, and the UI reports the degraded mode. Speech-to-text is not supported by the local chat model; use browser dictation or type the text.

Do not change the global `.env` just to switch databases; use the per-terminal `DB_NAME` variable described above.

---

## 9. Safety rules

- Do **not** run `python manage.py import_synthetic_v2` against `pms_db`.
- Do **not** run `seed_data`, `seed_enterprise_data`, or `populate_templates.py` against `pms_synthv2_test`.
- Do **not** run `import_synthetic_v2 --rollback --prefix SYNTHV2` unless you intentionally want to delete the synthetic-v2 data.
- Do **not** apply migrations to `pms_db`; it is already fully migrated.
- Do **not** commit `.env` or any file containing passwords or API keys.
- Do **not** use the old-data backup as a substitute for a fresh backup before any intentional change to `pms_synthv2_test`.

Reference: the synthetic database was created with:

```bash
DB_NAME=pms_synthv2_test python manage.py import_synthetic_v2 \
  --fixture matching/experiments/fixtures/synthetic_v2_seed42 \
  --prefix SYNTHV2 \
  --shift-months 12 \
  --yes
```

This is reference only. Re-running it updates the synthetic database.

---

## 10. Troubleshooting

### Backend connects to the wrong database

Check the active name:

```bash
DB_NAME=pms_synthv2_test python manage.py shell -c \
  "from django.conf import settings; print(settings.DATABASES['default']['NAME'])"
```

If the output is `pms_db`, a `DB_NAME` value from the shell or `.env` is taking precedence. Use an inline value or update `.env`.

### `database "pms_synthv2_test" does not exist`

Verify `DB_HOST` and `DB_PORT`. The synthetic database exists in the local PostgreSQL instance used for the import; it is not created automatically by `docker-compose.yml`.

### Login fails for synthetic users

Set the password first:

```bash
DB_NAME=pms_synthv2_test python manage.py changepassword synthv2_manager
```

### Frontend shows old data while the new backend is running

The frontend is using the wrong API URL. Check `frontend/.env.local` and start Vite with an explicit override:

```bash
VITE_API_URL=http://localhost:8001/api npm run dev -- --port 5174
```

### Port already in use

Use different ports, for example `8002` and `5175`, and update `VITE_API_URL` accordingly.

### AI candidate list is empty

The draft Top-3 uses all active employees, the same pool as saved-task matching; project membership is only a ranking signal (`already_member`), not a hard filter. Check that the project has eligible employees and that at least one required skill was extracted. The Top-3 endpoint does not pad the list when fewer than three candidates qualify. If the model extracted requirements but every employee fails a mandatory skill or availability check, the UI shows that result and the exclusion reasons instead of relabeling it as a missing local model. If you expect model-generated explanations, also check that Ollama is running.

### `migrate --check` fails for synthetic data

This is expected while `token_blacklist.0013_alter_blacklistedtoken_options_and_more` is unapplied. See the migration note in section 1.
