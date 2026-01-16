import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import { LoginPage, RegisterPage } from "./pages/Auth";
import { HomePage } from "./pages/Home";
import { LibraryPage } from "./pages/Library";
import { SeriesPage } from "./pages/Series";
import { VolumePage } from "./pages/Volume";
import { ViewerPage } from "./pages/Viewer";
import { SettingsPage } from "./pages/Settings";
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

// 관리자 전용 라우트 래퍼
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (user?.role !== "MASTER") {
    return (
      <Navigate
        to="/"
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

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const response = await api.get("/auth/setup");
        setNeedsSetup(response.data.needs_setup);
      } catch {
        setNeedsSetup(false);
      }
    };
    checkSetup();
  }, []);

  if (isLoading || needsSetup === null) {
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

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const response = await api.get("/auth/setup");
        setNeedsSetup(response.data.needs_setup);
      } catch {
        setNeedsSetup(false);
      }
    };
    checkSetup();
  }, []);

  if (isLoading || needsSetup === null) {
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
    <BrowserRouter>
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
              <AdminRoute>
                <SettingsPage />
              </AdminRoute>
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
    </BrowserRouter>
  );
}

export default App;
