"""Frozen skill/domain catalog used by synthetic experiments.

The names and categories mirror the catalog present in the working PostgreSQL
database at the time of the audit.  The frozen copy keeps experiment results
reproducible even if the live catalog changes later.
"""

SKILLS = [
    {"name": "Python", "category": "Backend"},
    {"name": "Django", "category": "Backend"},
    {"name": "FastAPI", "category": "Backend"},
    {"name": "PostgreSQL", "category": "Backend"},
    {"name": "Redis", "category": "Backend"},
    {"name": "React", "category": "Frontend"},
    {"name": "TypeScript", "category": "Frontend"},
    {"name": "CSS/SASS", "category": "Frontend"},
    {"name": "SQL", "category": "Data"},
    {"name": "Pandas", "category": "Data"},
    {"name": "Power BI", "category": "Data"},
    {"name": "Docker", "category": "DevOps"},
    {"name": "Kubernetes", "category": "DevOps"},
    {"name": "CI/CD", "category": "DevOps"},
    {"name": "Figma", "category": "Design"},
    {"name": "UX Research", "category": "Design"},
    {"name": "Project Management", "category": "Management"},
    {"name": "Agile/Scrum", "category": "Management"},
]

DOMAINS = ["EdTech", "GameDev", "GovTech", "HealthTech", "IT Infrastructure", "Retail"]

SKILL_NAMES = [item["name"] for item in SKILLS]
SKILL_BY_NAME = {item["name"]: item for item in SKILLS}

CATEGORY_SKILLS = {}
for item in SKILLS:
    CATEGORY_SKILLS.setdefault(item["category"], []).append(item["name"])

POSITIONS = {
    "Backend": ["Backend Developer", "Senior Backend Developer", "Platform Engineer"],
    "Frontend": ["Frontend Developer", "React Developer", "UI Engineer"],
    "Data": ["Data Analyst", "Data Engineer", "BI Analyst"],
    "DevOps": ["DevOps Engineer", "SRE", "Infrastructure Engineer"],
    "Design": ["Product Designer", "UX Researcher", "UI Designer"],
    "Management": ["Project Manager", "Delivery Manager", "Scrum Master"],
}
