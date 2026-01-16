import { useState } from "react";
import { Library, Users, Server, User, Settings } from "lucide-react";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { SubHeader } from "../components/SubHeader";
import { useAuthStore } from "../stores/authStore";
import "./Settings.css";

// 설정 탭 타입
// 설정 탭 타입
type SettingsTab = "general" | "libraries" | "users" | "system" | "account";

// 탭 정보
const TABS: { id: SettingsTab; label: string; icon: typeof Library; adminOnly?: boolean }[] = [
  { id: "general", label: "일반", icon: Settings },
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
  const availableTabs = TABS.filter((tab) => {
    if (tab.adminOnly && user?.role !== "MASTER") return false;
    return true;
  });

  // 콘텐츠 렌더링
  const renderContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralTab />;
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
    <div className="settings-page">
      <Header onMenuClick={() => setIsSidebarOpen(!isSidebarOpen)} />
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onAddLibrary={() => {}}
      />

      {/* 서브헤더 */}
      <SubHeader title="설정" />

      <div className="settings-container">
        <div className="settings-content">
          {/* 사이드 네비게이션 */}
          <nav className="settings-nav">
            {availableTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`nav-item ${activeTab === tab.id ? "active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={18} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* 콘텐츠 영역 */}
          <div className="settings-panel">{renderContent()}</div>
        </div>
      </div>
    </div>
  );
}

// 라이브러리 탭
function LibrariesTab() {
  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>라이브러리 관리</h2>
        <p className="tab-description">라이브러리 목록 조회 및 스캔 기능</p>
      </div>
      <div className="placeholder-content">
        <p>🚧 라이브러리 관리 기능 준비 중...</p>
      </div>
    </div>
  );
}

// 사용자 관리 탭
function UsersTab() {
  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>사용자 관리</h2>
        <p className="tab-description">사용자 목록 조회 및 관리</p>
      </div>
      <div className="placeholder-content">
        <p>🚧 사용자 관리 기능 준비 중...</p>
      </div>
    </div>
  );
}

// 시스템 탭
function SystemTab() {
  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>시스템 정보</h2>
        <p className="tab-description">서버 상태 및 캐시 관리</p>
      </div>
      <div className="placeholder-content">
        <p>🚧 시스템 정보 기능 준비 중...</p>
      </div>
    </div>
  );
}

// 내 계정 탭
function AccountTab() {
  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>내 계정</h2>
        <p className="tab-description">프로필 및 비밀번호 변경</p>
      </div>
      <div className="placeholder-content">
        <p>🚧 계정 설정 기능 준비 중...</p>
      </div>
    </div>
  );
}

// 일반 탭
function GeneralTab() {
  return (
    <div className="tab-content">
      <div className="tab-header">
        <h2>일반 설정</h2>
        <p className="tab-description">기본 애플리케이션 설정</p>
      </div>
      <div className="placeholder-content">
        <p>🚧 일반 설정 기능 준비 중...</p>
      </div>
    </div>
  );
}
