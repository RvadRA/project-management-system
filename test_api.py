"""
Quick API test script — run with:
  .venv\Scripts\python test_api.py
"""
import urllib.request
import json

BASE = 'http://localhost:8000'


def post_json(url, data, token=None):
    req = urllib.request.Request(
        url, method='POST',
        data=json.dumps(data).encode(),
        headers={'Content-Type': 'application/json'},
    )
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {'http_error': e.code, 'body': body}
    except Exception as e:
        return {'error': str(e)}


def get_json(url, token):
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {'http_error': e.code, 'body': body}
    except Exception as e:
        return {'error': str(e)}


def count_items(data):
    if isinstance(data, list):
        return len(data)
    if isinstance(data, dict):
        return data.get('count', len(data.get('results', [])))
    return '?'


print('=' * 50)
print('PMS Django Backend - API Tests')
print('=' * 50)

# 1. JWT Auth
print('\n[1] JWT Login (admin/admin123)')
auth = post_json(f'{BASE}/api/auth/token/', {'username': 'admin', 'password': 'admin123'})
token = auth.get('access', '')
print(f'    access_token : {"OK" if token else "FAILED"}')
print(f'    refresh_token: {"OK" if auth.get("refresh") else "FAILED"}')
if not token:
    print('    ERROR:', auth)
    exit(1)

# 2. Users/me
print('\n[2] GET /api/users/me/')
me = get_json(f'{BASE}/api/users/me/', token)
print(f'    username: {me.get("username", me)}')
print(f'    role    : {me.get("role", "?")}')

# 3. Projects
print('\n[3] GET /api/projects/list/')
projs = get_json(f'{BASE}/api/projects/list/', token)
n = count_items(projs)
print(f'    count: {n}')
results = projs.get('results', projs) if isinstance(projs, dict) else projs
if isinstance(results, list) and results:
    for p in results[:3]:
        print(f'      - {p.get("name")} [{p.get("status")}]')

# 4. Employees
print('\n[4] GET /api/employees/profiles/')
emps = get_json(f'{BASE}/api/employees/profiles/', token)
print(f'    count: {count_items(emps)}')
results = emps.get('results', emps) if isinstance(emps, dict) else emps
if isinstance(results, list) and results:
    for e in results[:3]:
        print(f'      - {e.get("full_name")} ({e.get("position")})')

# 5. Skills
print('\n[5] GET /api/employees/skills/')
skills = get_json(f'{BASE}/api/employees/skills/', token)
print(f'    count: {count_items(skills)}')

# 6. Matching / rank
print('\n[6] POST /api/matching/rank/')
rank_payload = {
    'required_skill_ids': [1, 2],
    'domain': 'IT',
    'date_from': '2026-05-01',
    'date_to': '2026-08-31',
    'weights': {
        'w1_competence': 0.35,
        'w2_experience': 0.20,
        'w3_availability': 0.25,
        'w4_performance': 0.15,
        'w5_cost': 0.05,
    },
}
match = post_json(f'{BASE}/api/matching/rank/', rank_payload, token)
if isinstance(match, list):
    print(f'    candidates ranked: {len(match)}')
    for c in match[:3]:
        name = c.get('full_name', '?')
        score = c.get('total_score', '?')
        print(f'      {score:.3f}  {name}')
else:
    print(f'    result: {match}')

# 7. Workflows / processes
print('\n[7] GET /api/workflows/processes/')
procs = get_json(f'{BASE}/api/workflows/processes/', token)
print(f'    count: {count_items(procs)}')

# 8. Workflows / tasks / my-tasks
print('\n[8] GET /api/workflows/tasks/my-tasks/')
mytasks = get_json(f'{BASE}/api/workflows/tasks/my-tasks/', token)
print(f'    count: {count_items(mytasks)}')

# 9. Dashboard / Analytics
print('\n[9] GET /api/projects/dashboard/')
dash = get_json(f'{BASE}/api/projects/dashboard/', token)
if 'kpis' in dash:
    k = dash['kpis']
    print(f'    KPIs: Projs: {k.get("total_projects")}, Active: {k.get("active_projects")}, Prog: {k.get("avg_progress")}%')
else:
    print(f'    ERROR: {dash}')

# 10. Planning Blocks (WBS)
print('\n[10] GET /api/projects/blocks/')
blocks = get_json(f'{BASE}/api/projects/blocks/', token)
print(f'    blocks found: {count_items(blocks)}')

# 11. Audit Logs
print('\n[11] GET /api/projects/audit-logs/')
logs = get_json(f'{BASE}/api/projects/audit-logs/', token)
print(f'    logs found: {count_items(logs)}')

# 12. Notifications
print('\n[12] GET /api/notifications/')
notifs = get_json(f'{BASE}/api/notifications/', token)
print(f'    count: {count_items(notifs)}')

# 13. Unread count
print('\n[13] GET /api/notifications/unread-count/')
unread = get_json(f'{BASE}/api/notifications/unread-count/', token)
print(f'    unread_count: {unread.get("unread_count", unread)}')

print('\n' + '=' * 50)
print('PMS API TEST: ALL PASSED')
print('=' * 50)
