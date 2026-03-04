"use client";

import { useState } from "react";
import { FileText, Eye, TrendingUp, BarChart3, Lightbulb } from "lucide-react";

interface ContentItem {
  id: number;
  title: string;
  views: number;
  likes: number;
  comments: number;
  outlierScore: number;
  publishedAt: string;
  engagementRate: number;
  recommendation: string;
}

const mockContent: ContentItem[] = [
  {
    id: 1,
    title: "How AI Agents Are Reshaping Personal Productivity",
    views: 128400,
    likes: 8920,
    comments: 743,
    outlierScore: 4.2,
    publishedAt: "2026-02-28",
    engagementRate: 7.5,
    recommendation:
      "This topic resonated strongly. Create a deep-dive on agent memory architectures and their impact on productivity.",
  },
  {
    id: 2,
    title: "The Future of Personal AI Assistants in 2026",
    views: 89200,
    likes: 5680,
    comments: 432,
    outlierScore: 2.9,
    publishedAt: "2026-02-25",
    engagementRate: 6.8,
    recommendation:
      "Strong performance. Consider exploring each prediction in depth as standalone research.",
  },
  {
    id: 3,
    title: "Building Autonomous Workflows With LLM Tool Calling",
    views: 67500,
    likes: 4100,
    comments: 289,
    outlierScore: 2.2,
    publishedAt: "2026-02-21",
    engagementRate: 6.5,
    recommendation:
      "Above average. Technical deep-dives with before/after examples work well — continue this format.",
  },
  {
    id: 4,
    title: "Semantic Memory with Supabase + pgvector — Architecture Guide",
    views: 45300,
    likes: 3200,
    comments: 198,
    outlierScore: 1.5,
    publishedAt: "2026-02-18",
    engagementRate: 7.5,
    recommendation:
      "Niche but highly engaged audience. Double down on technical architecture posts.",
  },
  {
    id: 5,
    title: "Comparing Gemini vs GPT-4o for Agent Tooling",
    views: 31200,
    likes: 1890,
    comments: 156,
    outlierScore: 1.0,
    publishedAt: "2026-02-14",
    engagementRate: 6.6,
    recommendation:
      "Average performance. Comparison pieces need stronger hooks — lead with surprising findings.",
  },
  {
    id: 6,
    title: "Why Most AI Tutorials Are Missing the Point",
    views: 22100,
    likes: 890,
    comments: 67,
    outlierScore: 0.7,
    publishedAt: "2026-02-10",
    engagementRate: 4.3,
    recommendation:
      'Negative framing underperformed. Reframe as constructive: "What AI tutorials should teach instead."',
  },
];

function getOutlierClass(score: number): string {
  if (score >= 3) return "outlier-viral";
  if (score >= 1.5) return "outlier-above";
  if (score >= 0.8) return "outlier-normal";
  return "outlier-below";
}

function formatViews(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

export default function ContentPage() {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const totalViews = mockContent.reduce((sum, c) => sum + c.views, 0);
  const avgEngagement =
    mockContent.reduce((sum, c) => sum + c.engagementRate, 0) /
    mockContent.length;
  const avgViews = totalViews / mockContent.length;

  const stats = [
    {
      label: "Articles Tracked",
      value: mockContent.length.toString(),
      badge: "+2 this week",
      gradient: "red",
    },
    {
      label: "Total Reads",
      value: formatViews(totalViews),
      badge: "+18K this week",
      gradient: "blue",
    },
    {
      label: "Avg Engagement",
      value: `${avgEngagement.toFixed(1)}%`,
      badge: "↑ 0.3%",
      gradient: "green",
    },
    {
      label: "Top Outlier",
      value: "4.2×",
      badge: "AI Agents article",
      gradient: "orange",
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>📊 Research Intel</h1>
        <p>Analytics and insights for content your agent monitors</p>
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

      {/* Outlier Baseline */}
      <div className="baseline-bar">
        <BarChart3
          size={18}
          style={{ color: "var(--brand-orange)", flexShrink: 0 }}
        />
        <span className="baseline-label">
          Outlier Baseline (avg of last 15)
        </span>
        <span className="baseline-value">
          {formatViews(Math.round(avgViews))} reads
        </span>
      </div>

      {/* Content Grid */}
      <div
        className="content-grid"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}
      >
        {mockContent.map((item, i) => (
          <div key={item.id} style={{ animationDelay: `${i * 80}ms` }}>
            <div
              className="content-card"
              onClick={() =>
                setExpandedId(expandedId === item.id ? null : item.id)
              }
            >
              <div className="content-thumbnail">
                <FileText size={32} className="content-thumbnail-placeholder" />
                <span
                  className={`outlier-badge ${getOutlierClass(item.outlierScore)}`}
                >
                  {item.outlierScore.toFixed(1)}×
                </span>
              </div>
              <div className="content-body">
                <div className="content-title">{item.title}</div>
                <div className="content-meta">
                  <span>
                    <Eye size={12} /> {formatViews(item.views)}
                  </span>
                  <span>
                    <TrendingUp size={12} /> {item.engagementRate}%
                  </span>
                  <span>{item.publishedAt}</span>
                </div>
              </div>
            </div>

            {/* Expanded Insights */}
            {expandedId === item.id && (
              <div className="insight-panel">
                <div className="insight-row">
                  <span className="label">Outlier Score</span>
                  <span className="value">
                    {item.outlierScore.toFixed(1)}× baseline
                  </span>
                </div>
                <div className="insight-row">
                  <span className="label">Engagement Rate</span>
                  <span className="value">{item.engagementRate}%</span>
                </div>
                <div className="insight-row">
                  <span className="label">Reads vs Average</span>
                  <span className="value">
                    {item.views > avgViews ? "+" : ""}
                    {((item.views / avgViews - 1) * 100).toFixed(0)}%
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 12,
                    padding: "12px",
                    background: "rgba(229, 133, 15, 0.06)",
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    gap: 8,
                  }}
                >
                  <Lightbulb
                    size={16}
                    style={{
                      color: "var(--brand-orange)",
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  />
                  <p
                    style={{
                      fontSize: "0.82rem",
                      color: "var(--text-secondary)",
                      lineHeight: 1.5,
                    }}
                  >
                    {item.recommendation}
                  </p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
