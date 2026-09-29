import { ClipboardText, ImageSquare, X } from "@phosphor-icons/react";

export const STATUS_CLASS = {
  在线: "approved",
  正常: "approved",
  启用: "approved",
  已完成: "approved",
  已通过: "approved",
  已锁版: "approved",
  已连接: "approved",
  可使用: "approved",
  制作中: "working",
  进行中: "working",
  生成中: "working",
  高清定稿: "working",
  待审核: "review",
  待接受: "review",
  待确认: "review",
  待生成: "muted",
  排队中: "muted",
  编辑中: "muted",
  待配置: "muted",
  待接入: "muted",
  待检测: "muted",
  离线: "muted",
  停用: "muted",
  已取消: "muted",
  已撤销: "muted",
  已过期: "muted",
  已用完: "muted",
  已拒绝: "danger",
  失败: "danger",
  连接失败: "danger",
  已废弃: "danger",
};

export function Status({ value, children }) {
  return <span className={`status-pill status-${STATUS_CLASS[value] || "muted"}`}>{children || value}</span>;
}

export function StatusPill({ status, children }) {
  return <Status value={status}>{children}</Status>;
}

export function PageHeader({ eyebrow, title, description, children }) {
  return (
    <header className="page-header admin-page-header">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

export function Metric({ icon: Icon, label, value, note, attention = false }) {
  return (
    <article className={`admin-metric ${attention ? "admin-metric-attention" : ""}`}>
      <div className="admin-metric-icon"><Icon size={18} /></div>
      <span>{label}</span><strong>{value}</strong><small>{note}</small>
    </article>
  );
}

export function Progress({ value = 0 }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  return <span className="admin-progress"><i><b style={{ width: `${safeValue}%` }} /></i><em>{safeValue}%</em></span>;
}

export function EmptyState({ icon: Icon = ClipboardText, title, description }) {
  return (
    <div className="oversight-empty">
      <div className="feature-icon"><Icon size={20} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function Modal({ title, eyebrow = "快捷操作", onClose, children, wide = false }) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <section className={`modal oversight-modal ${wide ? "modal-wide" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="关闭"><X size={17} /></button>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}

export function FormField({ label, children, full = false }) {
  return <label className={`form-field ${full ? "field-full" : ""}`}><span>{label}</span>{children}</label>;
}

export function AppButton({ variant = "secondary", children, className = "", ...props }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

export function CoverThumb({ src, alt }) {
  if (!src) return <div className="cover-placeholder"><ImageSquare size={16} /></div>;
  return <img src={src} alt={alt} />;
}
