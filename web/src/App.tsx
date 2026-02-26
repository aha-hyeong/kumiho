import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import { LoginPage, RegisterPage } from "./pages/Auth";
import { HomePage } from "./pages/Home";
import { LibraryPage } from "./pages/Library";
import { SeriesPage } from "./pages/Series";
import { VolumePage } from "./pages/Volume";
import { ViewerPage } from "./pages/Viewer";
import { SettingsPage } from "./pages/Settings";
import { SearchPage } from "./pages/Search";
import { useScrollToTop } from "./hooks/useScrollToTop";
import { api } from "./api/client";
import "./App.css";

// 인증 필요 라우트 래퍼
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  return <>{children}</>;
}

// 초기 설정 라우트 래퍼 (사용자가 없을 때만 허용)
function SetupRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [setupCheckFailed, setSetupCheckFailed] = useState(false);

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const response = await api.get("/auth/setup");
        setNeedsSetup(response.data.needs_setup);
        setSetupCheckFailed(false);
      } catch {
        // 서버/DB 초기화 직후 일시 실패 시 login/setup 사이 왕복 방지
        setSetupCheckFailed(true);
        setNeedsSetup(null);
      }
    };
    checkSetup();
  }, []);

  if (isLoading || (needsSetup === null && !setupCheckFailed)) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
      </div>
    );
  }

  // 이미 로그인되어 있으면 홈으로
  if (isAuthenticated) {
    return (
      <Navigate
        to="/"
        replace
      />
    );
  }

  if (setupCheckFailed) {
    return <>{children}</>;
  }

  // 초기 설정이 필요 없으면 (이미 사용자가 있으면) 로그인으로
  if (!needsSetup) {
    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  return <>{children}</>;
}

// 로그인 페이지 래퍼 (초기 설정이 필요하면 setup으로 리다이렉트)
function LoginRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [setupCheckFailed, setSetupCheckFailed] = useState(false);

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const response = await api.get("/auth/setup");
        setNeedsSetup(response.data.needs_setup);
        setSetupCheckFailed(false);
      } catch {
        // 서버/DB 초기화 직후 일시 실패 시 login/setup 사이 왕복 방지
        setSetupCheckFailed(true);
        setNeedsSetup(null);
      }
    };
    checkSetup();
  }, []);

  if (isLoading || (needsSetup === null && !setupCheckFailed)) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <Navigate
        to="/"
        replace
      />
    );
  }

  if (setupCheckFailed) {
    return <>{children}</>;
  }

  // 초기 설정이 필요하면 setup 페이지로
  if (needsSetup) {
    return (
      <Navigate
        to="/setup"
        replace
      />
    );
  }

  return <>{children}</>;
}

function App() {
  const checkAuth = useAuthStore((state) => state.checkAuth);
  useScrollToTop();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <Routes>
      {/* 초기 설정 (사용자가 없을 때) */}
      <Route
        path="/setup"
        element={
          <SetupRoute>
            <RegisterPage />
          </SetupRoute>
        }
      />

      {/* 로그인 (사용자가 있을 때) */}
      <Route
        path="/login"
        element={
          <LoginRoute>
            <LoginPage />
          </LoginRoute>
        }
      />

      {/* 레거시 register 라우트 → setup으로 리다이렉트 */}
      <Route
        path="/register"
        element={
          <Navigate
            to="/setup"
            replace
          />
        }
      />

      {/* 인증 필요 라우트 */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/libraries/:id"
        element={
          <ProtectedRoute>
            <LibraryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/series/:id"
        element={
          <ProtectedRoute>
            <SeriesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/volumes/:volumeId"
        element={
          <ProtectedRoute>
            <VolumePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/viewer/:chapterId"
        element={
          <ProtectedRoute>
            <ViewerPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/search"
        element={
          <ProtectedRoute>
            <SearchPage />
          </ProtectedRoute>
        }
      />

      {/* 404 */}
      <Route
        path="*"
        element={
          <Navigate
            to="/"
            replace
          />
        }
      />
    </Routes>
  );
}

export default App;
