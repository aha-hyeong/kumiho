import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import styles from "./Auth.module.css";

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login(email, password);
      navigate("/");
    } catch (err: any) {
      setError(err.response?.data?.error || "로그인에 실패했습니다");
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
          <p className={styles.authSubtitle}>개인 미디어 라이브러리</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className={styles.authForm}
        >
          <div className={styles.formGroup}>
            <label htmlFor="email">이메일</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
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
            {isLoading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        {/* 회원가입은 관리자만 가능 - 링크 제거 */}
      </div>
    </div>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useAuthStore((state) => state.register);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("비밀번호가 일치하지 않습니다");
      return;
    }

    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다");
      return;
    }

    setIsLoading(true);

    try {
      await register(username, email, password);
      navigate("/");
    } catch (err: any) {
      setError(err.response?.data?.error || "회원가입에 실패했습니다");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <h1 className={styles.authLogo}>🦊 Kumiho</h1>
          <p className={styles.authSubtitle}>관리자 계정 생성</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className={styles.authForm}
        >
          <div className={styles.formGroup}>
            <label htmlFor="username">사용자명</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="email">이메일</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
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

          <div className={styles.formGroup}>
            <label htmlFor="confirmPassword">비밀번호 확인</label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
            {isLoading ? "계정 생성 중..." : "계정 생성"}
          </button>
        </form>
        {/* 초기 설정 페이지이므로 로그인 링크 불필요 */}
      </div>
    </div>
  );
}
