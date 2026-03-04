"use client";

import { useState } from "react";
import {
  Plug,
  MessageCircle,
  Database,
  Sparkles,
  Globe,
  Search,
  Github,
  StickyNote,
  X,
  ExternalLink,
} from "lucide-react";

interface Connection {
  id: string;
  name: string;
  description: string;
  icon: typeof Plug;
  status: "active" | "inactive";
  viaZapier?: boolean;
}

const initialConnections: Connection[] = [
  {
    id: "telegram",
    name: "Telegram",
    description: "Primary chat interface",
    icon: MessageCircle,
    status: "active",
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Database & real-time",
    icon: Database,
    status: "active",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Primary LLM provider",
    icon: Sparkles,
    status: "active",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Fallback LLM provider",
    icon: Globe,
    status: "active",
  },
  {
    id: "tavily",
    name: "Tavily Search",
    description: "Web search tool",
    icon: Search,
    status: "active",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Code repository sync",
    icon: Github,
    status: "inactive",
    viaZapier: true,
  },
  {
    id: "notion",
    name: "Notion",
    description: "Knowledge base sync",
    icon: StickyNote,
    status: "inactive",
    viaZapier: true,
  },
  {
    id: "clickup",
    name: "ClickUp",
    description: "Task management",
    icon: ExternalLink,
    status: "inactive",
    viaZapier: true,
  },
];

export default function ConnectionsPage() {
  const [connections, setConnections] =
    useState<Connection[]>(initialConnections);

  const activeCount = connections.filter((c) => c.status === "active").length;
  const totalCount = connections.length;
  const progressPercent = (activeCount / totalCount) * 100;

  const toggleConnection = (id: string) => {
    setConnections((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, status: c.status === "active" ? "inactive" : "active" }
          : c,
      ),
    );
  };

  return (
    <div>
      <div className="page-header">
        <h1>🔌 Connections</h1>
        <p>Manage your agent&apos;s integrations and services</p>
      </div>

      {/* Progress Bar */}
      <div className="progress-bar-container">
        <div className="progress-label">
          <span>
            {activeCount} / {totalCount} connected
          </span>
          <span>{Math.round(progressPercent)}%</span>
        </div>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Connection Cards */}
      <div className="content-grid">
        {connections.map((conn, i) => {
          const Icon = conn.icon;
          const isActive = conn.status === "active";
          return (
            <div
              className={`connection-card ${!isActive ? "disconnected" : ""}`}
              key={conn.id}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {isActive && (
                <button
                  className="disconnect-btn"
                  onClick={() => toggleConnection(conn.id)}
                  title="Disconnect"
                >
                  <X size={12} />
                </button>
              )}

              <div className="connection-logo">
                <Icon size={20} />
              </div>
              <div className="connection-info">
                <h3>{conn.name}</h3>
                <p>{conn.description}</p>
                {conn.viaZapier && (
                  <span className="zapier-badge">via Zapier</span>
                )}
              </div>

              {isActive ? (
                <span className="status-badge active">Active</span>
              ) : (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => toggleConnection(conn.id)}
                >
                  Connect
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
