import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Folder, BookOpen, RefreshCw, ArrowLeft } from "lucide-react";
import { libraryAPI } from "../api/client";
import "./Library.css";

interface Library {
  id: string;
  name: string;
  path: string;
  last_scanned_at?: string;
}

interface Series {
  id: string;
  title: string;
  library_id: string;
  created_at: string;
}

export function LibraryPage() {
  const { id } = useParams<{ id: string }>();
  const [library, setLibrary] = useState<Library | null>(null);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    if (id) loadData();
  }, [id]);

  const loadData = async () => {
    try {
      const [libRes, seriesRes] = await Promise.all([libraryAPI.get(id!), libraryAPI.getSeries(id!)]);
      setLibrary(libRes.data);
      setSeriesList(seriesRes.data.series || []);
    } catch (error) {
      console.error("Failed to load library:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleScan = async () => {
    if (!id) return;
    setIsScanning(true);
    try {
      await libraryAPI.scan(id);
      await loadData();
    } catch (error) {
      console.error("Scan failed:", error);
    } finally {
      setIsScanning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
        <p>로딩 중...</p>
      </div>
    );
  }

  if (!library) {
    return (
      <div className="error-container">
        <p>라이브러리를 찾을 수 없습니다</p>
        <Link
          to="/"
          className="back-link"
        >
          홈으로
        </Link>
      </div>
    );
  }

  return (
    <div className="library-container">
      {/* 헤더 */}
      <header className="library-header">
        <div className="header-left">
          <Link
            to="/"
            className="back-button"
          >
            <ArrowLeft size={16} /> 뒤로
          </Link>
          <div className="library-title-section">
            <h1 className="library-name">
              <Folder size={24} /> {library.name}
            </h1>
            <p className="library-info-path">{library.path}</p>
          </div>
        </div>
        <div className="header-right">
          <button
            onClick={handleScan}
            disabled={isScanning}
            className="scan-btn"
          >
            {isScanning ? (
              <>
                <RefreshCw
                  size={16}
                  className="spin"
                />{" "}
                스캔 중...
              </>
            ) : (
              <>
                <RefreshCw size={16} /> 스캔
              </>
            )}
          </button>
        </div>
      </header>

      {/* 시리즈 그리드 */}
      <main className="library-main">
        <div className="series-count">
          총 <strong>{seriesList.length}</strong>개의 시리즈
        </div>

        {seriesList.length === 0 ? (
          <div className="empty-state">
            <p>스캔된 시리즈가 없습니다</p>
            <button
              onClick={handleScan}
              className="scan-btn primary"
            >
              <RefreshCw size={16} /> 지금 스캔하기
            </button>
          </div>
        ) : (
          <div className="series-grid">
            {seriesList.map((series) => (
              <Link
                key={series.id}
                to={`/series/${series.id}`}
                className="series-card"
              >
                <div className="series-cover">
                  <BookOpen size={48} />
                </div>
                <div className="series-info">
                  <h3 className="series-title">{series.title}</h3>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
