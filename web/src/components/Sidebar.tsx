import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { X, Folder, Plus, RefreshCw } from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import { libraryAPI } from "../api/client";
import "./Sidebar.css";

interface Library {
  id: string;
  name: string;
  path: string;
  last_scanned_at?: string;
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onAddLibrary: () => void;
  refreshKey?: number; // 이 값이 변경되면 라이브러리 목록 새로고침
}

export function Sidebar({ isOpen, onClose, onAddLibrary, refreshKey }: SidebarProps) {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadLibraries();
  }, [refreshKey]); // refreshKey가 변경되면 다시 로드

  const loadLibraries = async () => {
    try {
      const res = await libraryAPI.getAll();
      setLibraries(res.data.libraries || []);
    } catch (error) {
      console.error("Failed to load libraries:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleScan = async (libraryId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await libraryAPI.scan(libraryId);
      await loadLibraries();
    } catch (error) {
      console.error("Scan failed:", error);
    }
  };

  return (
    <>
      {/* 오버레이 */}
      <div
        className={`sidebar-overlay ${isOpen ? "open" : ""}`}
        onClick={onClose}
      />

      {/* 사이드바 */}
      <aside className={`sidebar ${isOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <h2>라이브러리</h2>
          <button
            className="close-btn"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className="sidebar-content">
          {isLoading ? (
            <div className="sidebar-loading">
              <div className="loading-spinner-small" />
            </div>
          ) : libraries.length === 0 ? (
            <div className="sidebar-empty">
              <p>라이브러리가 없습니다</p>
              {user?.role === "MASTER" && (
                <button
                  onClick={onAddLibrary}
                  className="add-library-btn"
                >
                  <Plus size={16} /> 추가하기
                </button>
              )}
            </div>
          ) : (
            <nav className="library-nav">
              {libraries.map((library) => (
                <Link
                  key={library.id}
                  to={`/libraries/${library.id}`}
                  className={`library-nav-item ${location.pathname === `/libraries/${library.id}` ? "active" : ""}`}
                  onClick={onClose}
                >
                  <div className="library-nav-icon">
                    <Folder size={18} />
                  </div>
                  <div className="library-nav-info">
                    <span className="library-nav-name">{library.name}</span>
                  </div>
                  <button
                    className="library-scan-btn"
                    onClick={(e) => handleScan(library.id, e)}
                    title="스캔"
                  >
                    <RefreshCw size={14} />
                  </button>
                </Link>
              ))}

              {user?.role === "MASTER" && (
                <button
                  onClick={onAddLibrary}
                  className="add-library-nav-btn"
                >
                  <Plus size={16} /> 라이브러리 추가
                </button>
              )}
            </nav>
          )}
        </div>
      </aside>
    </>
  );
}
