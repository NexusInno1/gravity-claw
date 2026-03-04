"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Zap,
  CheckSquare,
  MonitorPlay,
  Brain,
  Plug,
  Settings,
  Rocket,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Command Center", icon: LayoutDashboard },
  { href: "/productivity", label: "Productivity", icon: Zap },
  { href: "/tasks", label: "Tasks & Projects", icon: CheckSquare },
  { href: "/content", label: "Research Intel", icon: MonitorPlay },
  { href: "/brain", label: "Second Brain", icon: Brain },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <Rocket size={18} color="#fff" />
        </div>
        <div className="sidebar-logo-text">
          <h2>Mission Control</h2>
          <span>v1.0.0</span>
        </div>
      </div>

      {/* Agent Status */}
      <div className="agent-status">
        <div className="status-pulse" />
        <div className="status-text">
          <strong>Agent Online</strong>
          <br />
          Railway · Gemini 2.5 Flash
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${isActive ? "active" : ""}`}
            >
              <Icon className="nav-icon" size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* XP Bar */}
      <div className="xp-section">
        <div className="xp-label">
          <span>Level 7 — Field Agent</span>
          <span>2,847 XP</span>
        </div>
        <div className="xp-bar">
          <div className="xp-fill" style={{ width: "68%" }} />
        </div>
      </div>
    </aside>
  );
}
