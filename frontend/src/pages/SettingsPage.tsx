import { useEffect, useState } from "react";
import { Globe, Bell, FileText, Database, Users, UserCog, Settings } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Partners from "@/pages/Partners";
import UsersPage from "@/pages/Users";
import SourcesSettingsPage from "@/pages/settings/SourcesSettingsPage";
import NotificationsSettingsPage from "@/pages/settings/NotificationsSettingsPage";
import SecuritySettingsPage from "@/pages/settings/SecuritySettingsPage";
import CompanySettingsPage from "@/pages/settings/CompanySettingsPage";
import { hasRole } from "@/lib/auth";

const SETTINGS_TAB_KEY = "settings_active_tab";
const TAB_VALUES = ["sources", "entreprise", "notifications", "partenaires", "utilisateurs", "logs"] as const;
type SettingsTab = (typeof TAB_VALUES)[number];

export default function SettingsPage() {
  const isSysAdmin = hasRole("admin_systeme");
  const [activeTab, setActiveTab] = useState<SettingsTab>("sources");
  // Onglet Utilisateurs réservé à l'admin système : repli si accès indu (cache).
  const safeActiveTab: SettingsTab =
    activeTab === "utilisateurs" && !isSysAdmin ? "sources" : activeTab;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_TAB_KEY);
      if (!raw) return;
      if ((TAB_VALUES as readonly string[]).includes(raw)) {
        setActiveTab(raw as SettingsTab);
      }
    } catch {
      setActiveTab("sources");
    }
  }, []);

  const handleTabChange = (next: string) => {
    if (!(TAB_VALUES as readonly string[]).includes(next)) return;
    const value = next as SettingsTab;
    setActiveTab(value);
    localStorage.setItem(SETTINGS_TAB_KEY, value);
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={Settings} title="Paramètres" description="Configuration de la plateforme" />

      <Tabs value={safeActiveTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="sources" className="gap-2">
            <Globe className="h-4 w-4" />
            Sources
          </TabsTrigger>
          <TabsTrigger value="entreprise" className="gap-2">
            <Database className="h-4 w-4" />
            Entreprise
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="partenaires" className="gap-2">
            <Users className="h-4 w-4" />
            Partenaires
          </TabsTrigger>
          {isSysAdmin && (
            <TabsTrigger value="utilisateurs" className="gap-2">
              <UserCog className="h-4 w-4" />
              Utilisateurs
            </TabsTrigger>
          )}
          <TabsTrigger value="logs" className="gap-2">
            <FileText className="h-4 w-4" />
            Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sources">
          <Card className="p-5">
            <SourcesSettingsPage />
          </Card>
        </TabsContent>

        <TabsContent value="entreprise">
          <Card className="p-5">
            <CompanySettingsPage />
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card className="p-5">
            <NotificationsSettingsPage />
          </Card>
        </TabsContent>

        <TabsContent value="partenaires">
          <div className="space-y-4">
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Partenaires</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Gestion des partenaires stratégiques depuis les paramètres.
              </p>
            </Card>
            <Partners embedded />
          </div>
        </TabsContent>

        {isSysAdmin && (
          <TabsContent value="utilisateurs">
            <Card className="p-5">
              <UsersPage embedded />
            </Card>
          </TabsContent>
        )}

        <TabsContent value="logs">
          <Card className="p-5">
            <SecuritySettingsPage />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
