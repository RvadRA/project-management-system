import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { NotFoundPage, ForbiddenPage, ServerErrorPage } from './components/ErrorPages';
import ProtectedRoute from './components/ProtectedRoute';
import { AppProvider } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/AuthContext';
import { Toaster } from 'react-hot-toast';
import { STAFF_ROLES } from './utils/roles';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Projects = lazy(() => import('./pages/Projects'));
const Team = lazy(() => import('./pages/Team'));
const Matching = lazy(() => import('./pages/Matching'));
const Workflows = lazy(() => import('./pages/Workflows'));
const MyWorkspace = lazy(() => import('./pages/MyWorkspace'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Settings = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Profile'));
const Audit = lazy(() => import('./pages/Audit'));
const PlanningCatalog = lazy(() => import('./pages/PlanningCatalog'));
const Calendar = lazy(() => import('./pages/Calendar'));
const WorkflowEditor = lazy(() => import('./pages/WorkflowEditor'));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'));
const Login = lazy(() => import('./pages/Login'));

/** Block a route if user doesn't have the required role */
function RoleRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles: string[];
}) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Suspense fallback={<PageLoading />}><Login /></Suspense>} />

      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<PageLoading />}>
                <Routes>
                {/* Everyone */}
                <Route path="/" element={<Dashboard />} />
                <Route path="/workspace" element={<MyWorkspace />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/workflows" element={<Workflows />} />
                <Route path="/knowledge-base" element={<KnowledgeBase />} />
                <Route
                  path="/workflows/editor"
                  element={
                    <RoleRoute allowedRoles={STAFF_ROLES}>
                      <WorkflowEditor />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/workflows/editor/:id"
                  element={
                    <RoleRoute allowedRoles={STAFF_ROLES}>
                      <WorkflowEditor />
                    </RoleRoute>
                  }
                />

                {/* Администратор, руководитель проектов, менеджеры проектов */}
                <Route
                  path="/team"
                  element={
                    <RoleRoute allowedRoles={STAFF_ROLES}>
                      <Team />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/matching"
                  element={
                    <RoleRoute allowedRoles={STAFF_ROLES}>
                      <Matching />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/analytics"
                  element={
                    <RoleRoute allowedRoles={STAFF_ROLES}>
                      <Analytics />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <RoleRoute allowedRoles={['ADMIN']}>
                      <Settings />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/catalog"
                  element={
                    <RoleRoute allowedRoles={STAFF_ROLES}>
                      <PlanningCatalog />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/calendar"
                  element={
                    <RoleRoute allowedRoles={STAFF_ROLES}>
                      <Calendar />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/audit"
                  element={
                    <RoleRoute allowedRoles={STAFF_ROLES}>
                      <Audit />
                    </RoleRoute>
                  }
                />

                {/* Error pages */}
                <Route path="/403" element={<ForbiddenPage />} />
                <Route path="/500" element={<ServerErrorPage />} />
                <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function PageLoading() {
  return (
    <div className="flex min-h-40 items-center justify-center text-sm text-slate-400" role="status">
      Загрузка раздела…
    </div>
  );
}

function App() {
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.documentElement.classList.add('theme-light');
    } else {
      document.documentElement.classList.remove('theme-light');
    }
  }, []);

  return (
    <AuthProvider>
      <AppProvider>
        <Router>
          <Toaster position="top-right" toastOptions={{ duration: 3000, style: { background: 'var(--slate-900)', color: 'var(--slate-100)', border: '1px solid var(--slate-700)' } }} />
          <AppRoutes />
        </Router>
      </AppProvider>
    </AuthProvider>
  );
}

export default App;