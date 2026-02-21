import { getFacts, upsertFact } from "./facts-store.js";

// ── Onboarding — Core Profile Questions ──────────────────

/**
 * The questions Gravity Claw asks on first-ever interaction.
 * Answers are saved as Layer 3 facts and injected into EVERY prompt.
 * Keep this concise — each fact is ~10-30 tokens, so the total block
 * stays well under 500 tokens even with all questions answered.
 */
export const ONBOARDING_QUESTIONS: { key: string; question: string }[] = [
  {
    key: "name",
    question: "What's your name? (What should I call you?)",
  },
  {
    key: "role",
    question: "What do you do? (Your job, title, or main focus area)",
  },
  {
    key: "projects",
    question:
      "What are you currently working on? (Main project or business — keep it brief)",
  },
  {
    key: "goals",
    question:
      "What's your #1 goal right now? (What are you trying to achieve this month?)",
  },
  {
    key: "tech_stack",
    question:
      "What's your tech stack or tools of choice? (Languages, frameworks, platforms)",
  },
  {
    key: "communication_style",
    question:
      "How do you like responses? (e.g. concise & direct, detailed, casual, formal)",
  },
  {
    key: "timezone",
    question: "What timezone are you in? (e.g. IST, EST, GMT+5:30)",
  },
  {
    key: "fun_fact",
    question:
      "Anything else I should always remember about you? (A fun fact, pet peeve, preference — anything goes)",
  },
];

/** Track which onboarding question each user is currently on */
const onboardingState = new Map<
  string,
  { questionIndex: number; active: boolean }
>();

/**
 * Check if a user needs onboarding (no facts stored yet).
 */
export function needsOnboarding(userId: string): boolean {
  const facts = getFacts(userId);
  const state = onboardingState.get(userId);
  // Needs onboarding if no facts AND not currently mid-onboarding
  return Object.keys(facts).length === 0 && !state?.active;
}

/**
 * Start the onboarding flow for a user.
 * Returns the welcome message + first question.
 */
export function startOnboarding(userId: string): string {
  onboardingState.set(userId, { questionIndex: 0, active: true });

  return (
    "🦅 *Welcome to Gravity Claw\\!*\n\n" +
    "Before we dive in, I'd like to get to know you\\. " +
    "I'll ask a few quick questions so I can remember you forever\\.\n" +
    "Type `/skip` to skip any question\\.\n\n" +
    `*Question 1/${ONBOARDING_QUESTIONS.length}:*\n` +
    escapeMarkdownV2(ONBOARDING_QUESTIONS[0]!.question)
  );
}

/**
 * Process an onboarding answer and return the next question, or null if done.
 * Returns { message, done } — done=true means onboarding is complete.
 */
export function processOnboardingAnswer(
  userId: string,
  answer: string,
): { message: string; done: boolean } {
  const state = onboardingState.get(userId);
  if (!state || !state.active) {
    return { message: "", done: true };
  }

  const currentQ = ONBOARDING_QUESTIONS[state.questionIndex]!;
  const isSkip = answer.trim().toLowerCase() === "/skip";

  // Save the answer (unless skipped)
  if (!isSkip && answer.trim().length > 0) {
    upsertFact(userId, currentQ.key, answer.trim());
  }

  // Move to next question
  state.questionIndex++;

  // All done?
  if (state.questionIndex >= ONBOARDING_QUESTIONS.length) {
    state.active = false;
    onboardingState.delete(userId);

    const facts = getFacts(userId);
    const factCount = Object.keys(facts).length;

    return {
      message:
        `✅ *Onboarding complete\\!* I saved ${factCount} facts about you\\.\n\n` +
        "I'll remember all of this in every conversation\\. " +
        "You can update any fact anytime — just tell me naturally\\.\n\n" +
        "Now send me any message and let's get to work\\! 🦅",
      done: true,
    };
  }

  // Next question
  const nextQ = ONBOARDING_QUESTIONS[state.questionIndex]!;
  const qNum = state.questionIndex + 1;

  return {
    message:
      (isSkip ? "_Skipped\\._\n\n" : "✅ Got it\\!\n\n") +
      `*Question ${qNum}/${ONBOARDING_QUESTIONS.length}:*\n` +
      escapeMarkdownV2(nextQ.question),
    done: false,
  };
}

/**
 * Check if a user is currently in the middle of onboarding.
 */
export function isOnboarding(userId: string): boolean {
  const state = onboardingState.get(userId);
  return state?.active ?? false;
}

/** Escape special chars for Telegram MarkdownV2 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}
