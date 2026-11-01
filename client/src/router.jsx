import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppLayout } from './layouts/AppLayout.jsx';
import { GuestOnly, RequireAuth } from './layouts/RequireAuth.jsx';
import { WorkspaceScope } from './layouts/WorkspaceScope.jsx';

import {
  LoginPage,
  RegisterPage,
  ForgotPasswordPage,
  AccountActionPage,
} from './pages/AuthPages.jsx';

import LandingPage from './pages/LandingPage.jsx';
import { WorkspacesPage } from './pages/WorkspacesPage.jsx';
import { OverviewPage } from './pages/OverviewPage.jsx';
import { ProjectsPage } from './pages/ProjectsPage.jsx';
import { ProjectLayout } from './pages/project/ProjectLayout.jsx';
import { ProjectListView } from './pages/project/ProjectListView.jsx';
import { ProjectBoardView } from './pages/project/ProjectBoardView.jsx';
import { ProjectScheduleView } from './pages/project/ProjectScheduleView.jsx';
import { ProjectActivityView } from './pages/project/ProjectActivityView.jsx';
import { ActivityPage } from './pages/ActivityPage.jsx';
import { MyTasksPage } from './pages/MyTasksPage.jsx';
import { TeamPage } from './pages/TeamPage.jsx';
import { DocumentsPage } from './pages/DocumentsPage.jsx';
import { DiscussionsPage } from './pages/DiscussionsPage.jsx';
import IntegrationsPage from './pages/IntegrationsPage.jsx';
import { WorkspaceSettingsPage } from './pages/WorkspaceSettingsPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { AcceptInvitationPage } from './pages/AcceptInvitationPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';

import { useWorkspaces } from './context/WorkspaceContext.jsx';

// Legacy/short paths resolve against the current workspace.
function ToCurrent({ suffix }) {
  const { current, status } = useWorkspaces();

  if (status === 'loading') return null;

  return (
    <Navigate
      to={current ? `/workspaces/${current.id}${suffix}` : '/workspaces'}
      replace
    />
  );
}

const router = createBrowserRouter([
  // Public landing page
  {
    path: '/',
    element: <LandingPage />,
  },

  // Account actions
  {
    path: '/reset-password',
    element: <AccountActionPage mode="reset" />,
  },
  {
    path: '/verify-email',
    element: <AccountActionPage mode="verify" />,
  },

  // Guest routes
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },

  // Protected routes
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            path: 'workspaces',
            element: <WorkspacesPage />,
          },
          {
            path: 'workspaces/:workspaceId',
            element: <WorkspaceScope />,
            children: [
              { index: true, element: <OverviewPage /> },
              { path: 'projects', element: <ProjectsPage /> },
              {
                path: 'projects/:projectId',
                element: <ProjectLayout />,
                children: [
                  { index: true, element: <ProjectListView /> },
                  {
                    path: 'board',
                    element: <ProjectBoardView />,
                    handle: { wide: true },
                  },
                  {
                    path: 'calendar',
                    element: <ProjectScheduleView mode="calendar" />,
                    handle: { wide: true },
                  },
                  {
                    path: 'timeline',
                    element: <ProjectScheduleView mode="timeline" />,
                    handle: { wide: true },
                  },
                  { path: 'activity', element: <ProjectActivityView /> },
                ],
              },
              { path: 'activity', element: <ActivityPage /> },
              { path: 'tasks', element: <MyTasksPage /> },
              { path: 'team', element: <TeamPage /> },
              { path: 'documents', element: <DocumentsPage /> },
              { path: 'discussions', element: <DiscussionsPage /> },
              { path: 'integrations', element: <IntegrationsPage /> },
              { path: 'settings', element: <WorkspaceSettingsPage /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },

          { path: 'projects', element: <ToCurrent suffix="/projects" /> },
          { path: 'tasks', element: <ToCurrent suffix="/tasks" /> },
          { path: 'team', element: <ToCurrent suffix="/team" /> },
          { path: 'documents', element: <ToCurrent suffix="/documents" /> },
          { path: 'discussions', element: <ToCurrent suffix="/discussions" /> },
          { path: 'integrations', element: <ToCurrent suffix="/integrations" /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'profile', element: <Navigate to="/settings" replace /> },
          { path: 'invitations/accept', element: <AcceptInvitationPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },

  {
    path: '*',
    element: <NotFoundPage standalone />,
  },
]);

export default router;
