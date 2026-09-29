import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/layouts/AppLayout";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireRole } from "@/components/RequireRole";
import Dashboard from "@/pages/Dashboard";
import Opportunities from "@/pages/Opportunities";
import Favorites from "@/pages/Favorites";
import OpportunityDetails from "@/pages/OpportunityDetails";
import Partners from "@/pages/Partners";
import Notifications from "@/pages/Notifications";
import SubmittedTracking from "@/pages/SubmittedTracking";
import TrashPage from "@/pages/Trash";
import SettingsPage from "@/pages/SettingsPage";
import PersonnelDetailPage from "@/pages/settings/PersonnelDetailPage";
import ProjectDetailPage from "@/pages/settings/ProjectDetailPage";
import ChatPage from "@/pages/ChatPage";
import NotFound from "@/pages/NotFound";
import Login from "@/pages/Login";
import ChangePassword from "@/pages/ChangePassword";
import { fetchOpportunities } from "@/lib/opportunities-api";

const App = () => {
  useEffect(() => {
    // Précharge le catalogue (sans lancer un scrape — voir bouton « Vérifier les nouveautés »)
    void fetchOpportunities();
  }, []);

  return (
    <TooltipProvider>
      <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* Changement de mot de passe (plein écran, hors layout) — authentifié. */}
            <Route path="/change-password" element={<RequireAuth><ChangePassword /></RequireAuth>} />
            <Route
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/opportunities" element={<Opportunities />} />
              <Route path="/favorites" element={<Favorites />} />
              <Route path="/opportunities/:id" element={<OpportunityDetails />} />
              <Route path="/partners" element={<RequireRole min="admin_exploitation"><Partners /></RequireRole>} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/submitted-tracking" element={<SubmittedTracking />} />
              <Route path="/trash" element={<RequireRole min="admin_exploitation"><TrashPage /></RequireRole>} />
              <Route path="/settings" element={<RequireRole min="admin_exploitation"><SettingsPage /></RequireRole>} />
              {/* Profil consultable par tous les rôles (lecture seule) — l'édition est masquée aux non-admins dans la page. */}
              <Route path="/settings/personnel/:name" element={<PersonnelDetailPage />} />
              {/* Détail projet consultable par tous (lecture seule) — édition masquée aux non-admins dans la page. */}
              <Route path="/settings/projects/:title" element={<ProjectDetailPage />} />
              <Route path="/chat" element={<ChatPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
    </TooltipProvider>
  );
};

export default App;
