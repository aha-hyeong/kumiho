import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Library, Users, Server, User, Settings, Monitor, BarChart3, Rss } from "lucide-react";
import { Header } from "../components/headers/Header";
import { Sidebar } from "../components/Sidebar";
import { SubHeader } from "../components/headers/SubHeader";
import { useAuthStore } from "../stores/authStore";
import { GeneralTab } from "../components/settings/GeneralTab";
import { ViewerTab } from "../components/settings/ViewerTab";
import { LibrariesTab } from "../components/settings/LibrariesTab";
import { UsersTab } from "../components/settings/UsersTab";
import { SystemTab } from "../components/settings/SystemTab";
import { AccountTab } from "../components/settings/AccountTab";
import { StatisticsTab } from "../components/settings/StatisticsTab";
import { OPDSTab } from "../components/settings/OPDSTab";
import styles from "./Settings.module.css";

// 설정 탭 타입
type SettingsTab = "general" | "statistics" | "viewer" | "libraries" | "users" | "system" | "account" | "opds";

// 탭 정보
const TABS: { id: SettingsTab; label: string; icon: typeof Library; adminOnly?: boolean }[] = [
  { id: "general", label: "settings.tabs.general", icon: Settings },
  { id: "statistics", label: "settings.tabs.statistics", icon: BarChart3 },
  { id: "viewer", label: "settings.tabs.viewer", icon: Monitor, adminOnly: true },
  { id: "libraries", label: "settings.tabs.libraries", icon: Library, adminOnly: true },
  { id: "users", label: "settings.tabs.users", icon: Users, adminOnly: true },
  { id: "system", label: "settings.tabs.system", icon: Server, adminOnly: true },
  { id: "account", label: "settings.tabs.account", icon: User },
  { id: "opds", label: "settings.tabs.opds", icon: Rss },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const [activeTab, setActiveTabState] = useState<SettingsTab>("general");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // URL 파라미터와 탭 상태 동기화
  useEffect(() => {
    const tabParam = searchParams.get("tab") as SettingsTab;
    if (tabParam && TABS.some((t) => t.id === tabParam)) {
      setActiveTabState(tabParam);
    }
  }, [searchParams]);

  const setActiveTab = (tab: SettingsTab) => {
    setActiveTabState(tab);
    setSearchParams({ tab });
  };

  // 사용자 역할에 따른 탭 필터링
  const availableTabs = TABS.filter((tab) => !tab.adminOnly || user?.role === "MASTER");

  // 콘텐츠 렌더링
  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralTab />;
      case "statistics":
        return <StatisticsTab />;
      case "viewer":
        return <ViewerTab />;
      case "libraries":
        return <LibrariesTab />;
      case "users":
        return <UsersTab />;
      case "system":
        return <SystemTab />;
      case "account":
        return <AccountTab />;
      case "opds":
        return <OPDSTab />;
      default:
        return null;
    }
  };

  return (
    <div className={styles.settingsPage}>
      <Header onMenuClick={() => setIsSidebarOpen(!isSidebarOpen)} />
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* 서브헤더 */}
      <SubHeader title={t("settings.title")} />

      <div className={styles.settingsContainer}>
        <div className={styles.settingsContent}>
          {/* 사이드 네비게이션 */}
          <nav className={styles.settingsNav}>
            {availableTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`${styles.navItem} ${activeTab === tab.id ? styles.active : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={18} />
                  <span>{t(tab.label)}</span>
                </button>
              );
            })}
          </nav>

          {/* 콘텐츠 영역 */}
          <div className={styles.settingsPanel}>{renderContent()}</div>
        </div>
      </div>
    </div>
  );
}
