import { createBrowserRouter } from "react-router-dom";
import { AccessPage } from "../features/access/access-page";
import { DatasetsPage } from "../features/datasets/datasets-page";
import { RecordsIndexPage } from "../features/records/records-index";
import { RecordsPage } from "../features/records/records-page";
import { SchemaPage, SchemaEntry } from "../features/schema/schema-page";
import { TrashPage } from "../features/trash/trash-page";
import { AuthGate } from "../features/auth/auth-gate";
import { LoginPage } from "../features/auth/login-page";
import { AppShell } from "../features/shell/app-shell";
import { NotFoundPage } from "../features/shell/not-found-page";
import { RequireCapability, RequireRole } from "../features/shell/require-capability";
import { TeamPage } from "../features/team/team-page";
import { ActivityPage } from "../features/workspace/activity-page";
import { HomePage } from "../features/workspace/home-page";

export const router = createBrowserRouter([
  {
    element: <AuthGate />,
    children: [
      { path: "/login", element: <LoginPage /> },
      {
        path: "/",
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "datasets", element: <DatasetsPage /> },
          {
            path: "schema",
            element: (
              <RequireCapability capability="manageStructure">
                <SchemaEntry />
              </RequireCapability>
            ),
          },
          {
            path: "datasets/:id/schema",
            element: (
              <RequireCapability capability="manageStructure">
                <SchemaPage />
              </RequireCapability>
            ),
          },
          {
            path: "trash",
            element: (
              <RequireCapability capability="useTrash">
                <TrashPage />
              </RequireCapability>
            ),
          },
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
          {
            path: "activity",
            element: (
              <RequireRole roles={["admin", "manager"]}>
                <ActivityPage />
              </RequireRole>
            ),
          },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
