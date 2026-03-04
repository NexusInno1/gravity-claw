"use client";

import { useState } from "react";
import { Save, Loader2, Check, Settings as SettingsIcon } from "lucide-react";

interface ConfigEntry {
  key: string;
  value: string;
  category: string;
}

const mockConfig: ConfigEntry[] = [
  { key: "Bot Name", value: "Gravity Claw", category: "Identity" },
  { key: "Version", value: "1.0.0", category: "Identity" },
  { key: "Creator", value: "Admin", category: "Identity" },
  { key: "Primary Model", value: "gemini-2.5-flash", category: "Models" },
  { key: "Fallback Model", value: "mistral-small-3.1-24b", category: "Models" },
  { key: "Fallback Provider", value: "OpenRouter", category: "Models" },
  { key: "Heartbeat Time", value: "08:00 IST", category: "Schedule" },
  { key: "Content Sync Interval", value: "6 hours", category: "Schedule" },
  { key: "Memory Cleanup", value: "Weekly", category: "Schedule" },
  { key: "Max Conversation Buffer", value: "50 messages", category: "Memory" },
  { key: "Semantic Search Results", value: "5", category: "Memory" },
  { key: "Embedding Model", value: "text-embedding-004", category: "Memory" },
  { key: "Web Search Provider", value: "Tavily", category: "Tools" },
  { key: "Max Search Results", value: "5", category: "Tools" },
  { key: "URL Reader", value: "Built-in", category: "Tools" },
];

const defaultPersonality = `You are Gravity Claw, a sharp, precise, and deeply knowledgeable AI research assistant. You communicate with confidence and clarity, always backing up claims with reasoning.

Your personality traits:
- Direct and concise — no fluff
- Intellectually curious — always digging deeper
- Proactive — you anticipate what the user needs next
- Honest — if you don't know something, you say so
- Slightly witty — a dry sense of humor that doesn't get in the way

You never hallucinate links, never make up facts, and always verify before responding. You're the kind of assistant that makes people wonder how they ever worked without you.`;

export default function SettingsPage() {
  const [personality, setPersonality] = useState(defaultPersonality);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [config, setConfig] = useState(mockConfig);

  const handleSave = () => {
    setSaveState("saving");
    setTimeout(() => {
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    }, 1000);
  };

  const categories = [...new Set(config.map((c) => c.category))];

  const updateConfig = (key: string, newValue: string) => {
    setConfig((prev) =>
      prev.map((c) => (c.key === key ? { ...c, value: newValue } : c)),
    );
  };

  return (
    <div>
      <div className="page-header">
        <h1>⚙️ Settings</h1>
        <p>Tune your agent&apos;s personality and configuration</p>
      </div>

      {/* Personality Section */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="section-title">
          <SettingsIcon size={16} className="icon" />
          Personality & Character
        </div>
        <textarea
          className="settings-textarea"
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="Define your agent's personality..."
        />
        <div
          style={{
            marginTop: 14,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <button className="btn btn-primary" onClick={handleSave}>
            {saveState === "saving" ? (
              <>
                <Loader2 size={14} className="spin" /> Saving...
              </>
            ) : saveState === "saved" ? (
              <>
                <Check size={14} /> Saved
              </>
            ) : (
              <>
                <Save size={14} /> Save Changes
              </>
            )}
          </button>
          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
            Changes are saved to your agent&apos;s system prompt
          </span>
        </div>
      </div>

      {/* Config Entries */}
      <div className="card">
        <div className="section-title">
          <SettingsIcon size={16} className="icon" />
          Configuration
        </div>
        {categories.map((cat) => (
          <div className="config-category" key={cat}>
            <div className="config-category-title">{cat}</div>
            {config
              .filter((c) => c.category === cat)
              .map((entry) => (
                <div className="config-entry" key={entry.key}>
                  <span className="config-key">{entry.key}</span>
                  <input
                    className="config-value"
                    value={entry.value}
                    onChange={(e) => updateConfig(entry.key, e.target.value)}
                    onBlur={() => {
                      /* auto-save on blur */
                    }}
                  />
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
