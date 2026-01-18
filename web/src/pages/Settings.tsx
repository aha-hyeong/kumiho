import { useState } from "react";
import { Library, Users, Server, User, Settings, Monitor } from "lucide-react";
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
import styles from "./Settings.module.css";

// 설정 탭 타입
type SettingsTab = "general" | "viewer" | "libraries" | "users" | "system" | "account";

// 탭 정보
const TABS: { id: SettingsTab; label: string; icon: typeof Library; adminOnly?: boolean }[] = [
  { id: "general", label: "일반", icon: Settings },
  { id: "viewer", label: "뷰어", icon: Monitor },
  { id: "libraries", label: "라이브러리", icon: Library, adminOnly: true },
  { id: "users", label: "사용자 관리", icon: Users, adminOnly: true },
  { id: "system", label: "시스템", icon: Server, adminOnly: true },
  { id: "account", label: "내 계정", icon: User },
];

export function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // 사용자 역할에 따른 탭 필터링
  const availableTabs = TABS.filter((tab) => !tab.adminOnly || user?.role === "MASTER");

  // 콘텐츠 렌더링
  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralTab />;
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
      <SubHeader title="설정" />

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
                  <span>{tab.label}</span>
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
