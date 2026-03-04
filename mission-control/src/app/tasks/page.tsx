"use client";

import { useState, useEffect } from "react";
import {
  CheckSquare,
  Bot,
  AlertCircle,
  MessageSquare,
  Wrench,
  Heart,
  RefreshCw,
  Clock,
} from "lucide-react";

interface Task {
  id: number;
  title: string;
  status: "todo" | "in_progress" | "complete";
  priority: "high" | "medium" | "low";
  assignee?: string;
}

interface AgentAction {
  id: number;
  type: string;
  description: string;
  created_at: string;
}

const mockTasks: Task[] = [
  {
    id: 1,
    title: "Set up CI/CD pipeline for bot",
    status: "todo",
    priority: "high",
  },
  {
    id: 2,
    title: "Build research content pipeline",
    status: "todo",
    priority: "medium",
  },
  {
    id: 3,
    title: "Design notification preferences",
    status: "todo",
    priority: "low",
  },
  {
    id: 4,
    title: "Implement Mission Control dashboard",
    status: "in_progress",
    priority: "high",
  },
  {
    id: 5,
    title: "Add OpenRouter fallback logic",
    status: "in_progress",
    priority: "high",
  },
  {
    id: 6,
    title: "Fix heartbeat timezone bug",
    status: "in_progress",
    priority: "medium",
  },
  {
    id: 7,
    title: "Set up Supabase memory tables",
    status: "complete",
    priority: "high",
  },
  {
    id: 8,
    title: "Telegram bot authentication",
    status: "complete",
    priority: "high",
  },
  {
    id: 9,
    title: "Web search tool integration",
    status: "complete",
    priority: "medium",
  },
  {
    id: 10,
    title: "Core memory KV store",
    status: "complete",
    priority: "medium",
  },
];

const mockAgentActionData = [
  {
    id: 1,
    type: "heartbeat",
    description: "Daily heartbeat sent — 3 news items, 1 goal tracked",
    offset: 120000,
  },
  {
    id: 2,
    type: "message",
    description: "Responded to user query about project architecture",
    offset: 300000,
  },
  {
    id: 3,
    type: "tool_use",
    description: 'web_search: "Next.js 15 app router best practices"',
    offset: 450000,
  },
  {
    id: 4,
    type: "message",
    description: "Compiled daily brief with 5 action items",
    offset: 900000,
  },
  {
    id: 5,
    type: "tool_use",
    description: "read_url: docs.supabase.com/guides/realtime",
    offset: 1200000,
  },
  {
    id: 6,
    type: "heartbeat",
    description: "Scheduled sync completed — all systems nominal",
    offset: 3600000,
  },
  {
    id: 7,
    type: "content_sync",
    description: "Synced 4 new research articles",
    offset: 7200000,
  },
  {
    id: 8,
    type: "error",
    description: "Gemini API rate limit hit — OpenRouter fallback activated",
    offset: 10800000,
  },
];

const actionIcons: Record<string, typeof Heart> = {
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

export default function TasksPage() {
  const [activeTab, setActiveTab] = useState<"human" | "agent">("human");
  const [agentActions, setAgentActions] = useState<AgentAction[]>([]);

  // Generate timestamps client-side only to avoid hydration mismatch
  useEffect(() => {
    const now = Date.now();
    setAgentActions(
      mockAgentActionData.map((item) => ({
        id: item.id,
        type: item.type,
        description: item.description,
        created_at: new Date(now - item.offset).toISOString(),
      })),
    );
  }, []);

  const todo = mockTasks.filter((t) => t.status === "todo");
  const inProgress = mockTasks.filter((t) => t.status === "in_progress");
  const complete = mockTasks.filter((t) => t.status === "complete");

  const actionTypeCounts = agentActions.reduce(
    (acc, a) => {
      acc[a.type] = (acc[a.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div>
      <div className="page-header">
        <h1>✅ Tasks & Projects</h1>
        <p>Track your work and your agent&apos;s actions side by side</p>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === "human" ? "active" : ""}`}
          onClick={() => setActiveTab("human")}
        >
          <CheckSquare
            size={14}
            style={{ marginRight: 6, verticalAlign: -2 }}
          />
          Your Tasks
        </button>
        <button
          className={`tab ${activeTab === "agent" ? "active" : ""}`}
          onClick={() => setActiveTab("agent")}
        >
          <Bot size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
          Agent Actions
        </button>
      </div>

      {activeTab === "human" ? (
        /* Kanban Board */
        <div className="kanban-board">
          {[
            { title: "To Do", tasks: todo, color: "var(--text-muted)" },
            {
              title: "In Progress",
              tasks: inProgress,
              color: "var(--brand-orange)",
            },
            { title: "Complete", tasks: complete, color: "var(--brand-green)" },
          ].map((col) => (
            <div className="kanban-column" key={col.title}>
              <div className="kanban-column-header">
                <span style={{ color: col.color }}>{col.title}</span>
                <span className="kanban-column-count">{col.tasks.length}</span>
              </div>
              {col.tasks.map((task) => (
                <div className="kanban-card" key={task.id}>
                  <div className="kanban-card-title">{task.title}</div>
                  <div className="kanban-card-meta">
                    <span
                      className={`priority-dot priority-${task.priority}`}
                    />
                    <span>{task.priority}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        /* Agent Actions */
        <div>
          {/* Action type summary */}
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            {Object.entries(actionTypeCounts).map(([type, count]) => {
              const colors: Record<string, string> = {
                heartbeat: "green",
                message: "blue",
                tool_use: "orange",
                content_sync: "blue",
                error: "red",
              };
              return (
                <div className="stat-card" key={type}>
                  <div
                    className={`stat-gradient ${colors[type] || "orange"}`}
                  />
                  <div className="stat-body">
                    <div className="stat-label">{type.replace("_", " ")}</div>
                    <div className="stat-value">{count}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action log */}
          <div className="card">
            <div className="section-title">
              <Clock size={16} className="icon" />
              Action Log
            </div>
            <div className="activity-feed">
              {agentActions.map((action) => {
                const Icon = actionIcons[action.type] || Wrench;
                return (
                  <div className="activity-item" key={action.id}>
                    <div className={`activity-icon ${action.type}`}>
                      <Icon size={15} />
                    </div>
                    <div className="activity-text">
                      <p>{action.description}</p>
                      <span className="activity-time">
                        {timeAgo(action.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
