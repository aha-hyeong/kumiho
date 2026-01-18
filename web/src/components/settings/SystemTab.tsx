import styles from "../../pages/Settings.module.css";
import { Server } from "lucide-react";

export function SystemTab() {
  return (
    <div className={styles.tabContent}>
      <div className={styles.tabHeader}>
        <h2>시스템 정보</h2>
        <p className={styles.tabDescription}>서버 상태 확인 및 시스템 관리를 수행합니다.</p>
      </div>

      <div className={styles.settingsSections}>
        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <Server size={18} />
            <h3>서버 상태</h3>
          </div>
          <div className={styles.sectionContent}>
            <div
              className={styles.placeholderContent}
              style={{ minHeight: "150px" }}
            >
              <p>시스템 통계 기능이 곧 제공될 예정입니다.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
