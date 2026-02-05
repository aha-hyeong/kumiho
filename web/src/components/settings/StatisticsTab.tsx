import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { statsAPI } from "../../api/client";
import styles from "./SettingsComponents.module.css";
import localStyles from "./StatisticsTab.module.css";
import { Activity, BookOpen, Layers, Clock, Trophy, Loader2 } from "lucide-react";

interface DailyActivitySeries {
  id: string;
  title: string;
  thumbnail_path?: string;
}

interface DailyActivity {
  date: string;
  count: number;
  series?: DailyActivitySeries[];
}

interface HourlyActivity {
  hour: string;
  count: number;
}

interface Series {
  id: string;
  title: string;
  read_page_count?: number; // Calculated on backend
}

interface PersonalStats {
  total_series: number;
  total_read_time: number; // seconds
  total_volumes: number;
  total_chapters: number;
  total_completed_series: number;
  daily_activity: DailyActivity[];
  hourly_activity: HourlyActivity[];
  top_series: Series[];
}

export function StatisticsTab() {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<PersonalStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hoveredDate, setHoveredDate] = useState<DailyActivity | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const heatmapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await statsAPI.getPersonal();
        setStats(data);
      } catch (error) {
        console.error("Failed to fetch statistics:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchStats();
  }, []);

  // Scroll to end of heatmap on load
  useEffect(() => {
    if (stats && heatmapRef.current) {
      // Use requestAnimationFrame followed by a small timeout to ensure DOM is ready
      const scrollToEnd = () => {
        if (heatmapRef.current) {
          heatmapRef.current.scrollLeft = heatmapRef.current.scrollWidth;
        }
      };

      requestAnimationFrame(() => {
        setTimeout(scrollToEnd, 100);
      });
    }
  }, [stats]);

  // --- Heatmap Logic ---
  const renderHeatmap = () => {
    if (!stats) return null;

    const today = new Date();
    const weeks = 53;
    const days = 7;
    const blockSize = 12;
    const blockGap = 3;
    const textHeight = 20; // Space for Month labels
    const labelMargin = 30; // Space for Day labels
    const width = weeks * (blockSize + blockGap) + labelMargin;
    const height = days * (blockSize + blockGap) + textHeight;

    // Activity Map for O(1) lookup
    const activityMap = new Map<string, number>();
    stats.daily_activity.forEach((a) => activityMap.set(a.date, a.count));

    const grid = [];
    const monthLabels = [];
    let lastMonth = -1;

    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 365); // Approx start

    // Align start date to Sunday (or start of week)
    const dayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - dayOfWeek);

    // Day Labels (Mon, Wed, Fri)
    const dayLabels = [];
    for (let i = 0; i < 7; i++) {
      // Show Mon(1), Wed(3), Fri(5)
      if (i % 2 === 1) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        const dayName = new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(date);

        dayLabels.push(
          <text
            key={`day-${i}`}
            x={0}
            y={i * (blockSize + blockGap) + textHeight + blockSize - 2}
            className={localStyles.heatmapLabel}
            fill="#a0aec0"
            fontSize="10"
          >
            {dayName}
          </text>,
        );
      }
    }

    for (let w = 0; w < weeks; w++) {
      // Check for month change on the first day of the week (Sunday)
      const weekStartDate = new Date(startDate);
      weekStartDate.setDate(startDate.getDate() + w * 7);
      const currentMonth = weekStartDate.getMonth();

      if (currentMonth !== lastMonth) {
        lastMonth = currentMonth;
        const monthName = new Intl.DateTimeFormat(i18n.language, { month: "short" }).format(weekStartDate);
        let labelText = monthName;
        if (currentMonth === 0) {
          // January
          labelText = `${weekStartDate.getFullYear()}`;
        }

        monthLabels.push(
          <text
            key={`month-${w}`}
            x={w * (blockSize + blockGap) + labelMargin}
            y={textHeight - 5}
            className={localStyles.heatmapLabel}
            fill="#a0aec0"
            fontSize="10"
          >
            {labelText}
          </text>,
        );
      }

      for (let d = 0; d < days; d++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + w * 7 + d);

        // Skip future dates
        if (currentDate > today) continue;

        const dateStr = currentDate.toISOString().split("T")[0];
        const activity = stats.daily_activity.find((a) => a.date === dateStr) || { date: dateStr, count: 0 };
        const count = activity.count;

        // Color scale
        let color = "rgba(255,255,255,0.05)";
        if (count > 0) color = "#2b6cb0"; // level 1
        if (count > 5) color = "#4299e1"; // level 2
        if (count > 10) color = "#63b3ed"; // level 3
        if (count > 20) color = "#90cdf4"; // level 4

        grid.push(
          <rect
            key={dateStr}
            x={w * (blockSize + blockGap) + labelMargin}
            y={d * (blockSize + blockGap) + textHeight}
            width={blockSize}
            height={blockSize}
            fill={color}
            className={localStyles.heatmapRect}
            rx={2}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
              setHoveredDate(activity);
            }}
            onMouseLeave={() => setHoveredDate(null)}
          />,
        );
      }
    }

    return (
      <div style={{ position: "relative" }}>
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth: width, display: "block" }}
        >
          {dayLabels}
          {monthLabels}
          {grid}
        </svg>

        {hoveredDate && (
          <div
            className={localStyles.heatmapTooltip}
            style={{
              left: tooltipPos.x,
              top: tooltipPos.y - 10,
              transform: "translate(-50%, -100%)",
            }}
          >
            <div className={localStyles.tooltipDate}>{hoveredDate.date}</div>
            <div className={localStyles.tooltipCount}>
              {hoveredDate.count} {t("common.unit.pages", "pages")}
            </div>
            {hoveredDate.series && hoveredDate.series.length > 0 && (
              <div className={localStyles.tooltipThumbnails}>
                {hoveredDate.series.map((series) => (
                  <div
                    key={series.id}
                    className={localStyles.tooltipThumbWrapper}
                  >
                    <img
                      src={`/api/v1/series/${series.id}/thumbnail`}
                      alt={series.title}
                      className={localStyles.tooltipThumb}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/placeholder.png";
                      }}
                    />
                    <div className={localStyles.tooltipThumbTitle}>{series.title}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // --- Hourly Chart Logic ---
  const renderHourlyChart = () => {
    if (!stats) return null;

    // Fill missing hours with 0
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const activityMap = new Map<string, number>();
    stats.hourly_activity.forEach((a) => activityMap.set(a.hour, a.count));

    const maxCount = Math.max(...stats.hourly_activity.map((a) => a.count), 1);

    return (
      <div className={localStyles.barChart}>
        {hours.map((hour) => {
          const hourStr = hour.toString().padStart(2, "0");
          const count = activityMap.get(hourStr) || 0;
          const heightPercent = (count / maxCount) * 100;

          // Show label every 6 hours
          const showLabel = hour % 6 === 0;

          return (
            <div
              key={hour}
              className={localStyles.barColumn}
            >
              <div
                className={localStyles.bar}
                style={{ height: `${Math.max(heightPercent, 0)}%` }}
                title={`${hour}:00 - ${count}`}
              />
              {showLabel && <span className={localStyles.barLabel}>{hour}</span>}
            </div>
          );
        })}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className={styles.tabContent}>
        <div className={styles.placeholderContent}>
          <Loader2
            className={styles.loadingSpinner}
            size={24}
          />
          <p>{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tabContent}>
      <div className={styles.tabHeader}>
        <h2>{t("settings.statistics.title", "My Statistics")}</h2>
        <p className={styles.tabDescription}>{t("settings.statistics.desc", "Overview of your reading habits")}</p>
      </div>

      <div className={localStyles.statGrid}>
        <div className={localStyles.statCard}>
          <span className={localStyles.statLabel}>{t("settings.statistics.completed_series", "Series Completed")}</span>
          <span className={localStyles.statValue}>{stats?.total_completed_series.toLocaleString()}</span>
          <Trophy
            size={20}
            style={{ opacity: 0.5, marginTop: "auto" }}
          />
        </div>
        <div className={localStyles.statCard}>
          <span className={localStyles.statLabel}>{t("settings.statistics.total_volumes", "Volumes Completed")}</span>
          <span className={localStyles.statValue}>{stats?.total_volumes.toLocaleString()}</span>
          <BookOpen
            size={20}
            style={{ opacity: 0.5, marginTop: "auto" }}
          />
        </div>
        <div className={localStyles.statCard}>
          <span className={localStyles.statLabel}>{t("settings.statistics.total_chapters", "Chapters Read")}</span>
          <span className={localStyles.statValue}>{stats?.total_chapters.toLocaleString()}</span>
          <Layers
            size={20}
            style={{ opacity: 0.5, marginTop: "auto" }}
          />
        </div>
        <div className={localStyles.statCard}>
          <span className={localStyles.statLabel}>{t("settings.statistics.total_read_time", "Reading Time")}</span>
          <span className={localStyles.statValue}>
            {stats?.total_read_time
              ? (stats.total_read_time / 3600).toFixed(1) + t("common.unit.hours", "h")
              : `0${t("common.unit.hours", "h")}`}
          </span>
          <Clock
            size={20}
            style={{ opacity: 0.5, marginTop: "auto" }}
          />
        </div>
      </div>

      <div className={styles.settingsSections}>
        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <Activity size={18} />
            <h3>{t("settings.statistics.activity_heatmap", "Reading Activity")}</h3>
          </div>
          <div
            ref={heatmapRef}
            className={`${localStyles.chartContainer} ${localStyles.heatmapContainer}`}
          >
            {renderHeatmap()}
          </div>
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 350px), 1fr))",
            gap: "2rem",
          }}
        >
          <section className={styles.settingsSection}>
            <div className={styles.sectionTitle}>
              <Activity size={18} />
              <h3>{t("settings.statistics.hourly_activity", "Preferred Reading Time")}</h3>
            </div>
            <div className={localStyles.chartContainer}>{renderHourlyChart()}</div>
          </section>

          <section className={styles.settingsSection}>
            <div className={styles.sectionTitle}>
              <BookOpen size={18} />
              <h3>{t("settings.statistics.top_series", "Top Series")}</h3>
            </div>
            <div className={localStyles.topSeriesList}>
              {stats?.top_series.map((series, index) => (
                <div
                  key={series.id}
                  className={localStyles.seriesItem}
                >
                  <div
                    className={`${localStyles.rankBadge} ${index === 0 ? localStyles.rank1 : index === 1 ? localStyles.rank2 : index === 2 ? localStyles.rank3 : ""}`}
                  >
                    {index + 1}
                  </div>
                  <div className={localStyles.seriesInfo}>
                    <div className={localStyles.seriesTitle}>{series.title}</div>
                    <div className={localStyles.seriesMeta}>
                      {series.read_page_count || 0} {t("common.unit.pages", "Pages")}
                    </div>
                  </div>
                </div>
              ))}
              {(!stats?.top_series || stats.top_series.length === 0) && (
                <p style={{ color: "#718096", textAlign: "center", padding: "1rem" }}>
                  {t("common.no_data", "No data available")}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
