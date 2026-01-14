import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import "./SeriesCard.css";

export interface Series {
  id: string;
  title: string;
  library_id: string;
  created_at: string;
  updated_at: string;
  thumbnail_url?: string; // 백엔드에서 추가될 예정
}

export interface SeriesCardProps {
  series: Series;
  customSubtitle?: string;
  progress?: number;
}

export function SeriesCard({ series, customSubtitle, progress }: SeriesCardProps) {
  const formattedDate = new Date(series.updated_at).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });

  const getImageUrl = (url: string) => {
    const token = localStorage.getItem("access_token");
    if (!token) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}token=${token}`;
  };

  return (
    <Link
      to={`/series/${series.id}`}
      className="series-card"
    >
      <div className="series-cover">
        {series.thumbnail_url ? (
          <img
            src={getImageUrl(series.thumbnail_url)}
            alt={series.title}
            className="series-thumbnail"
            loading="lazy"
          />
        ) : (
          <BookOpen
            className="series-icon"
            size={48}
          />
        )}
      </div>
      <div className="series-info">
        <h3 className="series-title">{series.title}</h3>
        <div className="series-meta">
          <span>{customSubtitle || formattedDate}</span>
        </div>
        {typeof progress === "number" && (
          <div className="series-progress-track">
            <div
              className="series-progress-fill"
              style={{ width: `${Math.min(100, Math.max(0, isNaN(progress) ? 0 : progress))}%` }}
            />
          </div>
        )}
      </div>
    </Link>
  );
}
