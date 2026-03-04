"use client";

import { useState, useEffect, useRef } from "react";
import { Zap, Target, Plus, Trash2, Check, StickyNote } from "lucide-react";

const motivationalMessages = [
  {
    range: [0, 5],
    emoji: "🌱",
    message:
      "Every master was once a beginner. You've already started — that's the hardest part.",
  },
  {
    range: [6, 15],
    emoji: "🔥",
    message:
      "Two weeks in and you're still here. Most people quit by now. You're not most people.",
  },
  {
    range: [16, 25],
    emoji: "💪",
    message:
      "Momentum is building. The compound effect is real — keep stacking days.",
  },
  {
    range: [26, 35],
    emoji: "🎯",
    message:
      "You're entering the growth zone. The habits are becoming automatic.",
  },
  {
    range: [36, 45],
    emoji: "🚀",
    message:
      "Halfway there. Look back at day 1 — you wouldn't even recognize yourself.",
  },
  {
    range: [46, 55],
    emoji: "⚡",
    message:
      "You're in the top 10% of people who start challenges. The discipline is paying off.",
  },
  {
    range: [56, 65],
    emoji: "🏔️",
    message: "Two months of consistency. You're building something permanent.",
  },
  {
    range: [66, 75],
    emoji: "🌟",
    message: "The Scale phase. Everything you've built is compounding now.",
  },
  {
    range: [76, 85],
    emoji: "🏆",
    message:
      "Less than two weeks to go. You can taste the finish line. Don't coast.",
  },
  {
    range: [86, 90],
    emoji: "👑",
    message:
      "The final stretch. 90 days of discipline. You've proven it to yourself.",
  },
];

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

function getPhase(day: number): { name: string; range: string; index: number } {
  if (day <= 30) return { name: "Foundation", range: "1–30", index: 0 };
  if (day <= 60) return { name: "Growth", range: "31–60", index: 1 };
  return { name: "Scale", range: "61–90", index: 2 };
}

function getMotivation(completedDays: number) {
  const msg = motivationalMessages.find(
    (m) => completedDays >= m.range[0] && completedDays <= m.range[1],
  );
  return msg || motivationalMessages[0];
}

export default function ProductivityPage() {
  const [mounted, setMounted] = useState(false);

  // Initialize with defaults (SSR-safe) — localStorage loaded in useEffect
  const [habitDays, setHabitDays] = useState<boolean[]>(
    new Array(90).fill(false),
  );
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodoText, setNewTodoText] = useState("");
  const [notes, setNotes] = useState<string[]>(["", ""]);

  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  // Load persisted data from localStorage (client-only, after hydration)
  useEffect(() => {
    setMounted(true);
    try {
      const savedHabits = localStorage.getItem("mc-habit-days");
      if (savedHabits) setHabitDays(JSON.parse(savedHabits));
      const savedTodos = localStorage.getItem("mc-todos");
      if (savedTodos) setTodos(JSON.parse(savedTodos));
      const savedNotes = localStorage.getItem("mc-notes");
      if (savedNotes) setNotes(JSON.parse(savedNotes));
    } catch {}
  }, []);

  // Persist to localStorage (skip first render to avoid overwriting with defaults)
  useEffect(() => {
    if (mounted)
      localStorage.setItem("mc-habit-days", JSON.stringify(habitDays));
  }, [habitDays, mounted]);

  useEffect(() => {
    if (mounted) localStorage.setItem("mc-todos", JSON.stringify(todos));
  }, [todos, mounted]);

  useEffect(() => {
    if (mounted) localStorage.setItem("mc-notes", JSON.stringify(notes));
  }, [notes, mounted]);

  // Auto-resize textareas
  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  };

  const completedDays = habitDays.filter(Boolean).length;
  const today = completedDays; // Simplified — day index matches progress
  const currentPhase = getPhase(completedDays + 1);
  const progressPercent = Math.round((completedDays / 90) * 100);
  const motivation = getMotivation(completedDays);

  // Streak calculation
  let streak = 0;
  for (let i = habitDays.length - 1; i >= 0; i--) {
    if (habitDays[i]) streak++;
    else if (streak > 0) break;
  }

  const toggleDay = (index: number) => {
    setHabitDays((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  const addTodo = () => {
    if (!newTodoText.trim()) return;
    setTodos((prev) => [
      ...prev,
      { id: Date.now(), text: newTodoText.trim(), completed: false },
    ]);
    setNewTodoText("");
  };

  const toggleTodo = (id: number) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)),
    );
  };

  const deleteTodo = (id: number) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  const updateNote = (index: number, value: string) => {
    setNotes((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const phases = [
    { name: "Foundation", range: "1–30" },
    { name: "Growth", range: "31–60" },
    { name: "Scale", range: "61–90" },
  ];

  const stats = [
    {
      label: "Days Completed",
      value: completedDays.toString(),
      gradient: "green",
    },
    { label: "Current Streak", value: `${streak}d`, gradient: "orange" },
    { label: "Current Phase", value: currentPhase.name, gradient: "blue" },
    { label: "Progress", value: `${progressPercent}%`, gradient: "red" },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>⚡ Productivity</h1>
        <p>Track your 90-day challenge and daily habits</p>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className={`stat-gradient ${stat.gradient}`} />
            <div className="stat-body">
              <div className="stat-label">{stat.label}</div>
              <div className="stat-value">{stat.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Motivational Banner */}
      <div className="motivation-banner">
        <div className="emoji">{motivation.emoji}</div>
        <p>{motivation.message}</p>
      </div>

      {/* Phase Bar */}
      <div className="phase-bar">
        {phases.map((phase, i) => (
          <div
            className={`phase-segment ${currentPhase.index === i ? "active" : ""}`}
            key={phase.name}
          >
            {phase.name} ({phase.range})
          </div>
        ))}
      </div>

      {/* 90-Day Habit Grid */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="section-title">
          <Target size={16} className="icon" />
          90-Day Habit Tracker
        </div>
        <div className="habit-grid">
          {habitDays.map((completed, i) => {
            let cls = "habit-cell";
            if (completed) cls += " completed";
            else if (i === today) cls += " today";
            else if (i > today) cls += " future";
            return (
              <div
                key={i}
                className={cls}
                onClick={() => toggleDay(i)}
                title={`Day ${i + 1}`}
              />
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            gap: 16,
            fontSize: "0.72rem",
            color: "var(--text-muted)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: "var(--brand-green)",
                display: "inline-block",
              }}
            />{" "}
            Done
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: "var(--brand-blue)",
                display: "inline-block",
              }}
            />{" "}
            Today
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: "var(--bg-card)",
                opacity: 0.4,
                display: "inline-block",
              }}
            />{" "}
            Upcoming
          </span>
        </div>
      </div>

      <div className="two-col">
        {/* Quick Todos */}
        <div className="card">
          <div className="section-title">
            <Zap size={16} className="icon" />
            Quick Todos
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              value={newTodoText}
              onChange={(e) => setNewTodoText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTodo()}
              placeholder="Add a task..."
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary btn-sm" onClick={addTodo}>
              <Plus size={14} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {todos.map((todo) => (
              <div className="todo-item" key={todo.id}>
                <button
                  className={`todo-checkbox ${todo.completed ? "checked" : ""}`}
                  onClick={() => toggleTodo(todo.id)}
                >
                  {todo.completed && <Check size={12} color="#fff" />}
                </button>
                <span
                  className={`todo-text ${todo.completed ? "completed" : ""}`}
                >
                  {todo.text}
                </span>
                <button
                  className="todo-delete"
                  onClick={() => deleteTodo(todo.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {todos.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: 24,
                  color: "var(--text-muted)",
                  fontSize: "0.82rem",
                }}
              >
                No tasks yet — add one above
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="card">
          <div className="section-title">
            <StickyNote size={16} className="icon" />
            Notes
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {notes.map((note, i) => (
              <textarea
                key={i}
                ref={(el) => {
                  textareaRefs.current[i] = el;
                }}
                className="note-textarea"
                value={note}
                onChange={(e) => {
                  updateNote(i, e.target.value);
                  autoResize(e.target);
                }}
                placeholder={`Note ${i + 1}...`}
              />
            ))}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setNotes((prev) => [...prev, ""])}
              style={{ alignSelf: "flex-start" }}
            >
              <Plus size={14} /> Add Note
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
