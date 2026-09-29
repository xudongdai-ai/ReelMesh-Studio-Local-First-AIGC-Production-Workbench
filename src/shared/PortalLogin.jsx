import { useState } from "react";
import { ArrowRight, Eye, EyeSlash, LockKey } from "@phosphor-icons/react";
import { ROLE_SCOPES } from "./roles.js";

export function PortalLogin({ role, title, description, onLogin, initialError = "" }) {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const account = form.get("account")?.trim();
    const password = form.get("password")?.trim();
    if (!account || !password) return;
    setSubmitting(true);
    try {
      await onLogin(account, password);
    } catch (loginError) {
      setError(loginError.message || "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="login-card portal-login-card">
        <div className="brand-mark"><span className="brand-mark-letter" aria-hidden="true">R</span></div>
        <span className="portal-role-chip">{title}</span>
        <h1>ReelMesh Studio · {title}</h1>
        <p>{description}</p>
        <div className="portal-scope"><LockKey size={15} /><span>{ROLE_SCOPES[role]}</span></div>
        <form onSubmit={submit}>
          <label className="form-field"><span>账号</span><input name="account" autoComplete="username" required placeholder="请输入账号" /></label>
          <label className="form-field">
            <span>密码</span>
            <span className="password-field"><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required placeholder="请输入密码" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeSlash size={15} /> : <Eye size={15} />}</button></span>
          </label>
          {error && <small className="login-error">{error}</small>}
          <button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "正在登录" : `进入${title}`} <ArrowRight size={14} /></button>
        </form>
        <a className="portal-entry-link" href="./">返回统一登录入口</a>
        <small className="login-note">当前入口只接受对应身份账号。开发者创建组织和管理员，管理员创建经理和用户。</small>
      </section>
    </main>
  );
}
