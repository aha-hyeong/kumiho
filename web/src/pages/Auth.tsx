import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../stores/authStore";
import styles from "./Auth.module.css";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login(username, password);
      navigate("/");
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || t("auth.form.login_failed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <h1 className={styles.authLogo}>
            <img
              src="/Logo.svg"
              alt="Logo"
              className={styles.logoIcon}
            />
            Kumiho
          </h1>
          <p className={styles.authSubtitle}>{t("auth.subtitle")}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className={styles.authForm}
        >
          <div className={styles.formGroup}>
            <label htmlFor="username">{t("auth.form.id")}</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.trim())}
              placeholder={t("auth.form.id")}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="password">비밀번호</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div className={styles.errorMessage}>{error}</div>}

          <button
            type="submit"
            className={styles.authButton}
            disabled={isLoading}
          >
            {isLoading ? t("auth.form.logging_in") : t("auth.form.login_btn")}
          </button>
        </form>

        {/* 회원가입은 관리자만 가능 - 링크 제거 */}
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const register = useAuthStore((state) => state.register);
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t("auth.form.password_mismatch"));
      return;
    }

    if (password.length < 8) {
      setError(t("auth.form.password_min_length"));
      return;
    }

    setIsLoading(true);

    try {
      await register(username, nickname, password);
      navigate("/");
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || t("auth.form.create_failed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <h1 className={styles.authLogo}>
            <img
              src="/Logo.svg"
              alt="Logo"
              className={styles.logoIcon}
            />
            Kumiho
          </h1>
          <p className={styles.authSubtitle}>{t("auth.form.create_admin_subtitle")}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className={styles.authForm}
        >
          <div className={styles.formGroup}>
            <label htmlFor="username">{t("auth.form.id")}</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.trim())}
              placeholder={t("auth.form.id")}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="nickname">{t("auth.form.nickname")}</label>
            <input
              type="text"
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value.trim())}
              placeholder="구미호"
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="password">{t("auth.form.password")}</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("auth.form.password_placeholder")}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="confirmPassword">{t("auth.form.confirm_password")}</label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("auth.form.password_placeholder")}
              required
            />
          </div>

          {error && <div className={styles.errorMessage}>{error}</div>}

          <button
            type="submit"
            className={styles.authButton}
            disabled={isLoading}
          >
            {isLoading ? t("auth.form.creating_account") : t("auth.form.create_account")}
          </button>
        </form>
        {/* 초기 설정 페이지이므로 로그인 링크 불필요 */}
      </div>
    </div>
  );
}
