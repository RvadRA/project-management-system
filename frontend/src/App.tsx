import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Team from './pages/Team';
import Matching from './pages/Matching';
import Workflows from './pages/Workflows';
import MyWorkspace from './pages/MyWorkspace';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import Audit from './pages/Audit';
import PlanningCatalog from './pages/PlanningCatalog';
import Calendar from './pages/Calendar';
import WorkflowEditor from './pages/WorkflowEditor';
import { NotFoundPage, ForbiddenPage, ServerErrorPage } from './components/ErrorPages';
import Login from './pages/Login';
import ProtectedRoute from './components/ProtectedRoute';
import { AppProvider } from './context/AppContext';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/AuthContext';
import { Toaster } from 'react-hot-toast';

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
      <Route path="/login" element={<Login />} />

      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                {/* Everyone */}
                <Route path="/" element={<Dashboard />} />
                <Route path="/workspace" element={<MyWorkspace />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/workflows" element={<Workflows />} />
                <Route
                  path="/workflows/editor"
                  element={
                    <RoleRoute allowedRoles={['ADMIN', 'MANAGER']}>
                      <WorkflowEditor />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/workflows/editor/:id"
                  element={
                    <RoleRoute allowedRoles={['ADMIN', 'MANAGER']}>
                      <WorkflowEditor />
                    </RoleRoute>
                  }
                />

                {/* ADMIN + MANAGER only */}
                <Route
                  path="/team"
                  element={
                    <RoleRoute allowedRoles={['ADMIN', 'MANAGER']}>
                      <Team />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/matching"
                  element={
                    <RoleRoute allowedRoles={['ADMIN', 'MANAGER']}>
                      <Matching />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/analytics"
                  element={
                    <RoleRoute allowedRoles={['ADMIN', 'MANAGER']}>
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
                    <RoleRoute allowedRoles={['ADMIN', 'MANAGER']}>
                      <PlanningCatalog />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/calendar"
                  element={
                    <RoleRoute allowedRoles={['ADMIN', 'MANAGER']}>
                      <Calendar />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/audit"
                  element={
                    <RoleRoute allowedRoles={['ADMIN', 'MANAGER']}>
                      <Audit />
                    </RoleRoute>
                  }
                />

                {/* Error pages */}
                <Route path="/403" element={<ForbiddenPage />} />
                <Route path="/500" element={<ServerErrorPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <Router>
          <Toaster position="top-right" toastOptions={{ duration: 3000, style: { background: '#0f172a', color: '#fff', border: '1px solid #1e293b' } }} />
          <AppRoutes />
        </Router>
      </AppProvider>
    </AuthProvider>
  );
}

export default App;