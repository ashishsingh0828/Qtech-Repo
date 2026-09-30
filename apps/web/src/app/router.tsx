import { createBrowserRouter } from "react-router-dom";
import { AccessPage } from "../features/access/access-page";
import { DatasetsPage } from "../features/datasets/datasets-page";
import { RecordsIndexPage } from "../features/records/records-index";
import { RecordsPage } from "../features/records/records-page";
import { AuthGate } from "../features/auth/auth-gate";
import { LoginPage } from "../features/auth/login-page";
import { AppShell } from "../features/shell/app-shell";
import { NotFoundPage } from "../features/shell/not-found-page";
import { RequireCapability } from "../features/shell/require-capability";
import { TeamPage } from "../features/team/team-page";
import { WelcomePage } from "../features/welcome/welcome-page";

export const router = createBrowserRouter([
  {
    element: <AuthGate />,
    children: [
      { path: "/login", element: <LoginPage /> },
      {
        path: "/",
        element: <AppShell />,
        children: [
          { index: true, element: <WelcomePage /> },
          { path: "datasets", element: <DatasetsPage /> },
          { path: "records", element: <RecordsIndexPage /> },
          { path: "records/:datasetId", element: <RecordsPage /> },
          {
            path: "team",
            element: (
              <RequireCapability capability="manageUsers">
                <TeamPage />
              </RequireCapability>
            ),
          },
          {
            path: "access",
            element: (
              <RequireCapability capability="manageAccess">
                <AccessPage />
              </RequireCapability>
            ),
          },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
