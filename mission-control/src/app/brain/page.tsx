"use client";

import { useState, useRef, useCallback } from "react";
import {
  Brain,
  Search,
  FileText,
  Link2,
  Upload,
  Plus,
  Layers,
  Clock,
  Tag,
} from "lucide-react";

interface MemoryFact {
  id: number;
  content: string;
  category: string;
  created_at: string;
}

const mockFacts: MemoryFact[] = [
  {
    id: 1,
    content: "User prefers concise responses without unnecessary pleasantries",
    category: "preferences",
    created_at: "2026-03-03T10:00:00Z",
  },
  {
    id: 2,
    content:
      "Main project is Gravity Claw — a Telegram AI agent built with TypeScript",
    category: "projects",
    created_at: "2026-03-02T08:00:00Z",
  },
  {
    id: 3,
    content:
      "Uses Gemini 2.5 Flash as primary model with OpenRouter Mistral fallback",
    category: "technical",
    created_at: "2026-03-02T06:00:00Z",
  },
  {
    id: 4,
    content:
      "Supabase is the primary database — uses pgvector for semantic memory",
    category: "technical",
    created_at: "2026-03-01T12:00:00Z",
  },
  {
    id: 5,
    content:
      "Interested in AI agents, productivity systems, and content creation",
    category: "interests",
    created_at: "2026-02-28T15:00:00Z",
  },
  {
    id: 6,
    content: "Timezone is IST (UTC+5:30), heartbeat scheduled for 8:00 AM",
    category: "preferences",
    created_at: "2026-02-27T09:00:00Z",
  },
  {
    id: 7,
    content:
      "Working on a 90-day productivity challenge — currently in Phase 1 (Foundation)",
    category: "goals",
    created_at: "2026-02-26T14:00:00Z",
  },
  {
    id: 8,
    content:
      "Tracks AI research papers and industry articles for content intel",
    category: "projects",
    created_at: "2026-02-25T11:00:00Z",
  },
  {
    id: 9,
    content: "Prefers dark mode interfaces with minimal design",
    category: "preferences",
    created_at: "2026-02-24T16:00:00Z",
  },
  {
    id: 10,
    content: "Has 3 Gemini API keys configured for rotation on rate limits",
    category: "technical",
    created_at: "2026-02-23T08:00:00Z",
  },
];

const categories = [...new Set(mockFacts.map((f) => f.category))];

const categoryColors: Record<string, string> = {
  preferences: "var(--brand-orange)",
  projects: "var(--brand-blue)",
  technical: "var(--brand-green)",
  interests: "var(--brand-red)",
  goals: "var(--brand-orange)",
};

export default function BrainPage() {
  const [facts, setFacts] = useState(mockFacts);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeType, setActiveType] = useState<"note" | "url" | "file">("note");
  const [newContent, setNewContent] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredFacts = facts.filter(
    (f) =>
      f.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.category.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleAdd = () => {
    if (!newContent.trim()) return;

    if (bulkMode) {
      const lines = newContent.split("\n").filter((l) => l.trim());
      const newFacts = lines.map((line, i) => ({
        id: Date.now() + i,
        content: line.trim(),
        category: line.trim().startsWith("http") ? "urls" : "notes",
        created_at: new Date().toISOString(),
      }));
      setFacts((prev) => [...newFacts, ...prev]);
    } else {
      setFacts((prev) => [
        {
          id: Date.now(),
          content: newContent.trim(),
          category: activeType === "url" ? "urls" : "notes",
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
    setNewContent("");
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach((file) => {
      setFacts((prev) => [
        {
          id: Date.now() + Math.random(),
          content: `📎 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
          category: "files",
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
    });
  }, []);

  const statCards = [
    {
      label: "Stored Facts",
      value: facts.length.toString(),
      gradient: "orange",
    },
    {
      label: "Categories",
      value: categories.length.toString(),
      gradient: "blue",
    },
    { label: "Queued Items", value: "3", gradient: "green" },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>🧠 Second Brain</h1>
        <p>Your agent&apos;s knowledge base and memory store</p>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        {statCards.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className={`stat-gradient ${stat.gradient}`} />
            <div className="stat-body">
              <div className="stat-label">{stat.label}</div>
              <div className="stat-value">{stat.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="two-col">
        {/* Input Column */}
        <div>
          {/* Type Tabs */}
          <div className="type-tabs">
            <button
              className={`type-tab ${activeType === "note" ? "active-note" : ""}`}
              onClick={() => setActiveType("note")}
            >
              <FileText
                size={14}
                style={{ marginRight: 4, verticalAlign: -2 }}
              />
              Quick Note
            </button>
            <button
              className={`type-tab ${activeType === "url" ? "active-url" : ""}`}
              onClick={() => setActiveType("url")}
            >
              <Link2 size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
              URL
            </button>
            <button
              className={`type-tab ${activeType === "file" ? "active-file" : ""}`}
              onClick={() => {
                setActiveType("file");
                fileInputRef.current?.click();
              }}
            >
              <Upload size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
              File Upload
            </button>
          </div>

          {/* Input Area */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  fontSize: "0.78rem",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                {bulkMode
                  ? "Paste multiple items (one per line)"
                  : `Add a ${activeType}`}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setBulkMode(!bulkMode)}
                style={{ fontSize: "0.72rem" }}
              >
                {bulkMode ? "Single mode" : "Bulk mode"}
              </button>
            </div>
            <textarea
              className="note-textarea"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder={
                activeType === "url"
                  ? "https://example.com/article"
                  : bulkMode
                    ? "Paste multiple items, one per line..."
                    : "Type a quick note or fact..."
              }
              style={{ minHeight: bulkMode ? 150 : 80 }}
            />
            <button
              className="btn btn-primary"
              onClick={handleAdd}
              style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
            >
              <Plus size={14} /> Add to Brain
            </button>
          </div>

          {/* File Drop Zone */}
          <div
            className={`drop-zone ${isDragOver ? "active" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={24} />
            <p>Drop files here or click to upload</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              files.forEach((file) => {
                setFacts((prev) => [
                  {
                    id: Date.now() + Math.random(),
                    content: `📎 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
                    category: "files",
                    created_at: new Date().toISOString(),
                  },
                  ...prev,
                ]);
              });
            }}
          />
        </div>

        {/* Memory Column */}
        <div>
          {/* Search */}
          <div className="search-wrapper">
            <Search size={16} className="search-icon" />
            <input
              className="search-input"
              placeholder="Search memories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Memory Cards */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              maxHeight: 600,
              overflowY: "auto",
            }}
          >
            {filteredFacts.map((fact, i) => (
              <div
                className="memory-card"
                key={fact.id}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span
                  className="memory-tag"
                  style={{
                    background: `${categoryColors[fact.category] || "var(--brand-blue)"}18`,
                    color: categoryColors[fact.category] || "var(--brand-blue)",
                  }}
                >
                  {fact.category}
                </span>
                <div className="memory-content">{fact.content}</div>
                <div className="memory-time">
                  <Clock
                    size={10}
                    style={{ marginRight: 4, verticalAlign: -1 }}
                  />
                  {new Date(fact.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
              </div>
            ))}
            {filteredFacts.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: 40,
                  color: "var(--text-muted)",
                }}
              >
                <Brain size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
                <p>No memories found</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
