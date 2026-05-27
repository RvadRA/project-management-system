from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView,
)

urlpatterns = [
    path('admin/', admin.site.urls),

    # JWT Auth
    path('api/auth/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/token/verify/', TokenVerifyView.as_view(), name='token_verify'),

    # Users
    path('api/users/', include('accounts.urls')),

    # Employees (served by matching app)
    path('api/employees/', include('matching.employee_urls')),

    # Projects
    path('api/projects/', include('projects.urls')),

    # Matching
    path('api/matching/', include('matching.urls')),

    # Workflows
    path('api/workflows/', include('workflows.urls')),

    # Notifications
    path('api/notifications/', include('notifications.urls')),

    # Planning & WBS
    path('api/planning/', include('plans.urls')),

] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
