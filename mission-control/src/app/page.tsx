"use client";

import { useState, useEffect } from "react";
import {
  MessageSquare,
  Wrench,
  RefreshCw,
  Heart,
  Send,
  Play,
  FileText,
  Activity,
  AlertCircle,
  Cpu,
  Zap,
} from "lucide-react";

interface ActivityItem {
  id: number;
  type: "heartbeat" | "message" | "tool_use" | "content_sync" | "error";
  description: string;
  created_at: string;
}

const mockActivityData = [
  {
    id: 1,
    type: "heartbeat" as const,
    description: "Daily heartbeat sent — 3 news items, 1 goal tracked",
    offset: 120000,
  },
  {
    id: 2,
    type: "message" as const,
    description: "Responded to user query about project architecture",
    offset: 300000,
  },
  {
    id: 3,
    type: "tool_use" as const,
    description: 'web_search: "latest AI agent frameworks 2026"',
    offset: 450000,
  },
  {
    id: 4,
    type: "message" as const,
    description: "Processed follow-up on competitive analysis",
    offset: 900000,
  },
  {
    id: 5,
    type: "tool_use" as const,
    description: "read_url: arxiv.org/abs/2603.01234",
    offset: 1200000,
  },
  {
    id: 6,
    type: "heartbeat" as const,
    description: "Scheduled sync completed — all systems nominal",
    offset: 3600000,
  },
  {
    id: 7,
    type: "content_sync" as const,
    description: "Synced 4 new research articles from feeds",
    offset: 7200000,
  },
  {
    id: 8,
    type: "error" as const,
    description: "Gemini API rate limit — switched to OpenRouter fallback",
    offset: 10800000,
  },
  {
    id: 9,
    type: "message" as const,
    description: "Compiled daily brief with 5 action items",
    offset: 14400000,
  },
  {
    id: 10,
    type: "tool_use" as const,
    description: "get_current_time: IST timezone check",
    offset: 18000000,
  },
];

const activityIcons: Record<string, typeof Heart> = {
  heartbeat: Heart,
  message: MessageSquare,
  tool_use: Wrench,
  content_sync: RefreshCw,
  error: AlertCircle,
};

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function CommandCenter() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [, setTick] = useState(0);

  // Generate mock data client-side only (Date.now() differs between server and client)
  useEffect(() => {
    const now = Date.now();
    setActivities(
      mockActivityData.map((item) => ({
        id: item.id,
        type: item.type,
        description: item.description,
        created_at: new Date(now - item.offset).toISOString(),
      })),
    );
  }, []);

  // Update the time-ago display every 30s
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const stats = [
    {
      label: "Messages Handled",
      value: "1,247",
      badge: "+23 today",
      gradient: "orange",
    },
    { label: "Tool Calls", value: "892", badge: "+14 today", gradient: "blue" },
    {
      label: "Content Synced",
      value: "156",
      badge: "+4 today",
      gradient: "green",
    },
    {
      label: "Agent Uptime",
      value: "99.7%",
      badge: "14d streak",
      gradient: "red",
    },
  ];

  const config = [
    { label: "Model", value: "Gemini 2.5 Flash" },
    { label: "Provider", value: "Google AI + OpenRouter fallback" },
    { label: "Memory Stack", value: "Core → Buffer → Semantic (pgvector)" },
    { label: "Heartbeat", value: "Daily 8:00 AM IST" },
    { label: "Content Sync", value: "Every 6 hours" },
    { label: "Fallback Model", value: "Mistral Small 3.1 24B" },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>🏠 Command Center</h1>
        <p>Real-time overview of your agent&apos;s activity and systems</p>
      </div>

      {/* Stat Cards */}
      <div className="stats-grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className={`stat-gradient ${stat.gradient}`} />
            <div className="stat-body">
              <div className="stat-label">{stat.label}</div>
              <div className="stat-value">{stat.value}</div>
              <span className="stat-badge">{stat.badge}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="two-col">
        {/* Activity Feed */}
        <div className="card">
          <div className="section-title">
            <Activity size={16} className="icon" />
            Live Activity Feed
          </div>
          <div className="activity-feed">
            {activities.map((item) => {
              const Icon = activityIcons[item.type] || Zap;
              return (
                <div className="activity-item" key={item.id}>
                  <div className={`activity-icon ${item.type}`}>
                    <Icon size={15} />
                  </div>
                  <div className="activity-text">
                    <p>{item.description}</p>
                    <span className="activity-time">
                      {timeAgo(item.created_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column */}
        <div>
          {/* Agent Config */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="section-title">
              <Cpu size={16} className="icon" />
              Agent Configuration
            </div>
            <div className="config-display">
              {config.map((c) => (
                <div className="config-display-item" key={c.label}>
                  <div className="label">{c.label}</div>
                  <div className="value">{c.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="card">
            <div className="section-title">
              <Zap size={16} className="icon" />
              Quick Actions
            </div>
            <div className="quick-actions">
              <button className="btn btn-primary">
                <Send size={14} /> Send Heartbeat
              </button>
              <button className="btn btn-secondary">
                <RefreshCw size={14} /> Sync Content
              </button>
              <button className="btn btn-secondary">
                <Play size={14} /> Run Daily Brief
              </button>
              <button className="btn btn-ghost">
                <FileText size={14} /> View Logs
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
