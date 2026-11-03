"""Read-only ProJectMS API load profile for an explicitly approved test host."""

import os
from urllib.parse import urlsplit

from locust import HttpUser, between, events, task
from locust.exception import StopTest


READ_ENDPOINTS = (
    "/api/projects/list/?page=1",
    "/api/workflows/processes/?page=1",
    "/api/workflows/tasks/?page=1",
    "/api/matching/skills/?page=1",
)


@events.test_start.add_listener
def require_approved_test_environment(environment, **_kwargs):
    host = (environment.host or "").rstrip("/")
    approved_host = os.environ.get("LOADTEST_APPROVED_HOST", "").rstrip("/")
    environment_name = os.environ.get("LOADTEST_ENVIRONMENT")
    access_token = os.environ.get("LOADTEST_ACCESS_TOKEN")
    project_id = os.environ.get("LOADTEST_TEST_PROJECT_ID", "")
    parsed_host = urlsplit(host)

    if environment_name != "isolated-test":
        raise StopTest("Set LOADTEST_ENVIRONMENT=isolated-test only for an isolated test deployment.")
    if not host or not approved_host or host != approved_host:
        raise StopTest("Locust --host must exactly match LOADTEST_APPROVED_HOST.")
    if parsed_host.scheme not in {"http", "https"} or not parsed_host.hostname:
        raise StopTest("LOADTEST_APPROVED_HOST must be an absolute HTTP(S) origin.")
    if not access_token:
        raise StopTest("Provide an access token issued for a dedicated test account.")
    if not project_id.isdigit():
        raise StopTest("Provide LOADTEST_TEST_PROJECT_ID from the isolated synthetic fixture.")
    if os.environ.get("LOADTEST_CONFIRM_ISOLATED_DATABASE") != "YES":
        raise StopTest("Confirm that the approved host uses an isolated test database.")


class ProjectManagementReadOnlyUser(HttpUser):
    wait_time = between(1, 3)

    def on_start(self):
        token = os.environ["LOADTEST_ACCESS_TOKEN"]
        self.client.headers.update({"Authorization": f"Bearer {token}"})
        self.endpoint_index = 0

    @task(3)
    def read_list_endpoint(self):
        endpoint = READ_ENDPOINTS[self.endpoint_index]
        self.endpoint_index = (self.endpoint_index + 1) % len(READ_ENDPOINTS)

        self._get(endpoint, endpoint.split("?")[0])

    @task
    def filter_tasks_by_test_project(self):
        project_id = os.environ["LOADTEST_TEST_PROJECT_ID"]
        self._get(
            f"/api/projects/tasks/?project_id={project_id}&page=1",
            "/api/projects/tasks/?project_id=[test-project]",
        )

    @task
    def search_knowledge_materials(self):
        self._get(
            "/api/projects/knowledge-materials/?scope=global&search=loadtest&page=1",
            "/api/projects/knowledge-materials/?scope=global&search=[term]",
        )

    def _get(self, endpoint, request_name):
        with self.client.get(endpoint, name=request_name, catch_response=True) as response:
            if response.status_code == 401:
                response.failure("Test access token is invalid or expired.")
            elif response.status_code >= 500:
                response.failure(f"Server returned HTTP {response.status_code}.")
            elif response.status_code >= 400:
                response.failure(f"Read endpoint returned HTTP {response.status_code}.")
