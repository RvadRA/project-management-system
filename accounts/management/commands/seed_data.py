"""
Management command: python manage.py seed_data

Creates:
  - 1 admin user (admin / admin123)
  - 6 employees (e.g. a.ivanov / password123)
  - 18 skills across 4 categories
  - 5 projects with members and audit logs
  - 3 workflow processes (templates + instances)
  - EmployeeProfiles linked to each user
  - Workload entries and project participations for realistic scoring
"""
import datetime
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.utils import timezone

User = get_user_model()


class Command(BaseCommand):
    help = 'Seed the database with demo data for the Project Management System'

    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING('[SEED] Seeding demo data...'))

        self._create_users()
        self._create_skills()
        self._create_projects()
        self._create_workflows()

        self.stdout.write(self.style.SUCCESS('[DONE] Seed complete!'))

    # ─────────────────────────────────────────────────────────────────
    def _create_users(self):
        from matching.models import EmployeeProfile

        # Admin
        admin, created = User.objects.get_or_create(
            username='admin',
            defaults={
                'email': 'admin@company.com',
                'first_name': 'Admin',
                'last_name': 'User',
                'role': 'ADMIN',
                'is_staff': True,
                'is_superuser': True,
                'department': 'Management',
            },
        )
        if created:
            admin.set_password('admin123')
            admin.save()
            self.stdout.write(f'  Created admin: admin / admin123')
        else:
            self.stdout.write(f'  Admin already exists, skipping.')

        # Employee definitions
        employees_data = [
            {
                'username': 'a.ivanov',
                'first_name': 'Alexei',
                'last_name': 'Ivanov',
                'email': 'a.ivanov@company.com',
                'department': 'IT',
                'position': 'Senior Backend Developer',
                'hourly_rate': 4500,
                'bio': 'Expert in Python and distributed systems.',
            },
            {
                'username': 'm.smirnova',
                'first_name': 'Maria',
                'last_name': 'Smirnova',
                'email': 'm.smirnova@company.com',
                'department': 'IT',
                'position': 'Frontend Developer',
                'hourly_rate': 3800,
                'bio': 'React and TypeScript specialist.',
            },
            {
                'username': 'd.petrov',
                'first_name': 'Dmitri',
                'last_name': 'Petrov',
                'email': 'd.petrov@company.com',
                'department': 'Analytics',
                'position': 'Data Analyst',
                'hourly_rate': 3200,
                'bio': 'SQL and Python data pipelines.',
            },
            {
                'username': 'e.kozlova',
                'first_name': 'Elena',
                'last_name': 'Kozlova',
                'email': 'e.kozlova@company.com',
                'department': 'Design',
                'position': 'UX/UI Designer',
                'hourly_rate': 3500,
                'bio': 'Figma and design systems expert.',
            },
            {
                'username': 'n.volkov',
                'first_name': 'Nikolai',
                'last_name': 'Volkov',
                'email': 'n.volkov@company.com',
                'department': 'IT',
                'position': 'DevOps Engineer',
                'hourly_rate': 4200,
                'bio': 'Kubernetes, CI/CD and infrastructure automation.',
            },
            {
                'username': 's.lebedeva',
                'first_name': 'Sofia',
                'last_name': 'Lebedeva',
                'email': 's.lebedeva@company.com',
                'department': 'QA',
                'position': 'QA Engineer',
                'hourly_rate': 2900,
                'bio': 'Automated and manual testing.',
            },
        ]

        self._employee_users = []
        for data in employees_data:
            position = data.pop('position')
            hourly_rate = data.pop('hourly_rate')
            bio = data.pop('bio')

            user, created = User.objects.get_or_create(
                username=data['username'],
                defaults={**data, 'role': 'EMPLOYEE'},
            )
            if created:
                user.set_password('password123')
                user.save()
                self.stdout.write(f"  Created employee: {user.username} / password123")

            department = data.get('department', '')
            profile, _ = EmployeeProfile.objects.update_or_create(
                user=user,
                defaults={
                    'position': position,
                    'hourly_rate': hourly_rate,
                    'bio': bio,
                    'department': department
                },
            )
            self._employee_users.append((user, profile))

    # ─────────────────────────────────────────────────────────────────
    def _create_skills(self):
        from matching.models import Skill, EmployeeSkill

        skills_data = [
            # Backend
            ('Python', 'Backend'), ('Django', 'Backend'), ('FastAPI', 'Backend'),
            ('PostgreSQL', 'Backend'), ('Redis', 'Backend'),
            # Frontend
            ('React', 'Frontend'), ('TypeScript', 'Frontend'), ('CSS/SASS', 'Frontend'),
            # Data
            ('SQL', 'Data'), ('Pandas', 'Data'), ('Power BI', 'Data'),
            # DevOps
            ('Docker', 'DevOps'), ('Kubernetes', 'DevOps'), ('CI/CD', 'DevOps'),
            # Design
            ('Figma', 'Design'), ('UX Research', 'Design'),
            # General
            ('Project Management', 'Management'), ('Agile/Scrum', 'Management'),
        ]

        self._skills = {}
        for name, category in skills_data:
            skill, _ = Skill.objects.get_or_create(name=name, defaults={'category': category})
            self._skills[name] = skill

        self.stdout.write(f'  Created/verified {len(self._skills)} skills')

        # Assign skills to employees
        skill_assignments = {
            'a.ivanov':   [('Python', 5), ('Django', 5), ('PostgreSQL', 4), ('Redis', 3), ('Docker', 3)],
            'm.smirnova': [('React', 5), ('TypeScript', 4), ('CSS/SASS', 4), ('Figma', 2)],
            'd.petrov':   [('SQL', 5), ('Python', 3), ('Pandas', 4), ('Power BI', 4)],
            'e.kozlova':  [('Figma', 5), ('UX Research', 4), ('CSS/SASS', 3)],
            'n.volkov':   [('Docker', 5), ('Kubernetes', 5), ('CI/CD', 5), ('Python', 2)],
            's.lebedeva': [('Agile/Scrum', 4), ('SQL', 2), ('CI/CD', 2)],
        }

        for user, profile in self._employee_users:
            assignments = skill_assignments.get(user.username, [])
            for skill_name, level in assignments:
                skill = self._skills.get(skill_name)
                if skill:
                    EmployeeSkill.objects.get_or_create(
                        employee=profile,
                        skill=skill,
                        defaults={'level': level, 'years_experience': level * 0.8},
                    )

    # ─────────────────────────────────────────────────────────────────
    def _create_projects(self):
        from projects.models import Project, ProjectMember, AuditLog, PlanningBlock, Task
        from matching.models import WorkloadEntry, ProjectParticipation

        today = datetime.date.today()

        projects_data = [
            {
                'name': 'E-Commerce Platform Redesign',
                'description': 'Complete redesign of the company e-commerce platform using modern React frontend and Django REST backend.',
                'domain': 'IT',
                'status': 'ACTIVE',
                'start_date': today - datetime.timedelta(days=60),
                'end_date': today + datetime.timedelta(days=90),
                'budget': 1200000,
            },
            {
                'name': 'Analytics Dashboard',
                'description': 'Build a real-time analytics dashboard with Power BI integration and custom SQL data pipelines.',
                'domain': 'Data',
                'status': 'ACTIVE',
                'start_date': today - datetime.timedelta(days=30),
                'end_date': today + datetime.timedelta(days=60),
                'budget': 600000,
            },
            {
                'name': 'Infrastructure Migration to Kubernetes',
                'description': 'Migrate all production services from Docker Compose to Kubernetes cluster with full CI/CD pipeline.',
                'domain': 'DevOps',
                'status': 'ACTIVE',
                'start_date': today - datetime.timedelta(days=15),
                'end_date': today + datetime.timedelta(days=75),
                'budget': 850000,
            },
            {
                'name': 'Mobile App UX Overhaul',
                'description': 'User research and complete redesign of the mobile application UX flow based on Figma prototypes.',
                'domain': 'Design',
                'status': 'DRAFT',
                'start_date': today + datetime.timedelta(days=14),
                'end_date': today + datetime.timedelta(days=120),
                'budget': 450000,
            },
            {
                'name': 'Internal HR Automation',
                'description': 'Automate HR workflows: onboarding, leave requests and performance reviews using Django workflows.',
                'domain': 'IT',
                'status': 'COMPLETED',
                'start_date': today - datetime.timedelta(days=180),
                'end_date': today - datetime.timedelta(days=30),
                'budget': 780000,
            },
        ]

        admin_user = User.objects.filter(username='admin').first()
        user_map = {u.username: u for u, _ in self._employee_users}
        profile_map = {u.username: p for u, p in self._employee_users}

        self._projects = []
        for data in projects_data:
            project, created = Project.objects.get_or_create(
                name=data['name'],
                defaults={**data, 'manager': admin_user},
            )
            if created:
                AuditLog.objects.create(
                    project=project,
                    user=admin_user,
                    action='PROJECT_CREATED',
                    detail={'name': project.name},
                )
                self.stdout.write(f"  Created project: {project.name}")
            self._projects.append(project)

        # Assign members to projects
        member_assignments = {
            'E-Commerce Platform Redesign': ['a.ivanov', 'm.smirnova', 's.lebedeva'],
            'Analytics Dashboard': ['d.petrov', 'a.ivanov'],
            'Infrastructure Migration to Kubernetes': ['n.volkov', 'a.ivanov'],
            'Mobile App UX Overhaul': ['e.kozlova', 'm.smirnova'],
            'Internal HR Automation': ['a.ivanov', 'd.petrov', 's.lebedeva'],
        }
        role_map = {
            'a.ivanov': 'DEVELOPER', 'm.smirnova': 'DEVELOPER', 'd.petrov': 'ANALYST',
            'e.kozlova': 'DESIGNER', 'n.volkov': 'DEVELOPER', 's.lebedeva': 'QA',
        }

        for project in self._projects:
            for uname in member_assignments.get(project.name, []):
                u = user_map.get(uname)
                if u:
                    ProjectMember.objects.get_or_create(
                        project=project, user=u,
                        defaults={'role': role_map.get(uname, 'OTHER')},
                    )

        # Add workload entries (for scoring)
        workload_data = [
            ('a.ivanov', 'E-Commerce Platform Redesign', today - datetime.timedelta(days=60),
             today + datetime.timedelta(days=90), 60),
            ('m.smirnova', 'E-Commerce Platform Redesign', today - datetime.timedelta(days=60),
             today + datetime.timedelta(days=90), 80),
            ('d.petrov', 'Analytics Dashboard', today - datetime.timedelta(days=30),
             today + datetime.timedelta(days=60), 70),
            ('n.volkov', 'Infrastructure Migration to Kubernetes', today - datetime.timedelta(days=15),
             today + datetime.timedelta(days=75), 90),
        ]
        project_name_map = {p.name: p for p in self._projects}
        for uname, pname, start, end, load in workload_data:
            profile = profile_map.get(uname)
            project = project_name_map.get(pname)
            if profile and project:
                WorkloadEntry.objects.get_or_create(
                    employee=profile,
                    project=project,
                    start_date=start,
                    end_date=end,
                    defaults={'load_percent': load},
                )

        # Add past performance (participations) for completed project
        completed = project_name_map.get('Internal HR Automation')
        if completed:
            perf_data = [
                ('a.ivanov', 'DEVELOPER', 0.92),
                ('d.petrov', 'ANALYST', 0.85),
                ('s.lebedeva', 'QA', 0.78),
            ]
            for uname, role, score in perf_data:
                profile = profile_map.get(uname)
                if profile:
                    ProjectParticipation.objects.get_or_create(
                        employee=profile,
                        project=completed,
                        defaults={
                            'role': role,
                            'performance_score': score,
                            'joined_at': completed.start_date,
                            'left_at': completed.end_date,
                        },
                    )

        # Create a planning block template
        block, created = PlanningBlock.objects.get_or_create(
            name='Standard Sprint Template',
            is_template=True,
            defaults={'domain': 'IT'},
        )
        if created:
            tasks = [
                ('Requirements Analysis', 3, 0),
                ('Design & Architecture', 5, 3),
                ('Backend Development', 10, 8),
                ('Frontend Development', 10, 8),
                ('Testing & QA', 5, 18),
                ('Deployment & Review', 2, 23),
            ]
            for name, duration, offset in tasks:
                Task.objects.get_or_create(
                    block=block,
                    name=name,
                    defaults={'duration_days': duration, 'start_offset_days': offset},
                )
            self.stdout.write('  Created planning block template: Standard Sprint Template')

    # ─────────────────────────────────────────────────────────────────
    def _create_workflows(self):
        from workflows.models import (
            WorkflowTemplate, WorkflowTaskTemplate, WorkflowInstance, WorkflowTask
        )

        admin_user = User.objects.filter(username='admin').first()

        templates_data = [
            {
                'name': 'Employee Onboarding',
                'description': 'Standard onboarding process for new employees.',
                'tasks': [
                    ('Send Welcome Package', 'CHECKLIST', 1, 0),
                    ('Setup Workstation', 'CHECKLIST', 4, 1),
                    ('HR Documentation', 'FILE_UPLOAD', 8, 2),
                    ('Security Briefing', 'TEXT_REPORT', 2, 3),
                    ('Team Introduction Meeting', 'TEXT_REPORT', 1, 4),
                ],
            },
            {
                'name': 'Feature Release Process',
                'description': 'Standard process for releasing a new feature.',
                'tasks': [
                    ('Code Review', 'APPROVAL', 4, 0),
                    ('QA Testing', 'TEXT_REPORT', 8, 1),
                    ('Staging Deployment', 'CHECKLIST', 2, 2),
                    ('Product Owner Approval', 'APPROVAL', 4, 3),
                    ('Production Deployment', 'CHECKLIST', 2, 4),
                ],
            },
            {
                'name': 'Project Kickoff',
                'description': 'Process for starting a new project.',
                'tasks': [
                    ('Define Project Scope', 'TEXT_REPORT', 8, 0),
                    ('Assemble Team', 'CHECKLIST', 4, 1),
                    ('Kickoff Meeting', 'TEXT_REPORT', 2, 2),
                    ('Create Project Plan', 'FILE_UPLOAD', 12, 3),
                ],
            },
        ]

        for tpl_data in templates_data:
            tasks = tpl_data.pop('tasks')
            tpl, created = WorkflowTemplate.objects.get_or_create(
                name=tpl_data['name'],
                defaults={**tpl_data, 'is_published': True, 'created_by': admin_user},
            )
            if created:
                self.stdout.write(f"  Created workflow template: {tpl.name}")
                for order, (name, task_type, sla, seq) in enumerate(tasks):
                    WorkflowTaskTemplate.objects.create(
                        template=tpl,
                        name=name,
                        task_type=task_type,
                        sla_hours=sla,
                        order=order,
                    )

        # Create one active workflow instance from the first template
        tpl = WorkflowTemplate.objects.filter(name='Feature Release Process').first()
        project = self._projects[0] if self._projects else None
        if tpl and project:
            inst, created = WorkflowInstance.objects.get_or_create(
                name=f'{tpl.name} — {project.name}',
                defaults={
                    'template': tpl,
                    'project': project,
                    'status': 'IN_PROGRESS',
                    'started_at': timezone.now(),
                    'created_by': admin_user,
                },
            )
            if created:
                user_map = {u.username: u for u, _ in self._employee_users}
                assignees = ['a.ivanov', 's.lebedeva', 'n.volkov', None, None]
                for order, tt in enumerate(tpl.task_templates.all()):
                    assignee_name = assignees[order] if order < len(assignees) else None
                    assigned = user_map.get(assignee_name) if assignee_name else None
                    task_status = 'DONE' if order == 0 else ('IN_PROGRESS' if order == 1 else 'TODO')
                    WorkflowTask.objects.create(
                        workflow=inst,
                        task_template=tt,
                        name=tt.name,
                        description=tt.description,
                        task_type=tt.task_type,
                        sla_hours=tt.sla_hours,
                        order=tt.order,
                        status=task_status,
                        assigned_to=assigned,
                        due_date=timezone.now() + timezone.timedelta(hours=tt.sla_hours),
                    )
                self.stdout.write(f"  Created workflow instance: {inst.name}")
