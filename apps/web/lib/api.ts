import { mockApi } from "./mock";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export interface SessionCreateResponse {
  session_id: string;
  role_id: string;
  orientation: string;
  current_role: string | null;
}

export interface PathRole {
  id: string;
  label: string;
  label_zh: string;
}

export interface PathsResponse {
  current_roles: PathRole[];
  target_roles: PathRole[];
}

export interface OrientationOut {
  id: string;
  label: string;
  description: string;
}

export interface JdMatchResponse {
  orientation: string;
  orientation_label: string;
  description: string;
  matched: boolean;
  signals: string[];
}

export interface OptionOut {
  value: string;
  label: string;
}

export interface Progress {
  answered: number;
  max: number;
}

export interface QuestionOut {
  question_id: string;
  skill_id: string;
  category: string;
  text: string;
  help_text: string;
  ui_type: string;
  options: OptionOut[];
  progress: Progress;
}

export interface NextQuestionResponse {
  result_ready: boolean;
  question: QuestionOut | null;
}

export interface SkillProfileOut {
  skill_id: string;
  skill_name: string;
  category: string;
  level: number;
  confidence: number;
}

export interface StrengthOut {
  skill_id: string;
  skill_name: string;
  category: string;
  level: number;
  reason: string;
  ai_usage: string[];
  non_ai_boundaries: string[];
}

export interface GapOut {
  skill_id: string;
  skill_name: string;
  category: string;
  current_level: number;
  target_level: number;
  gap: number;
  type: "required" | "bonus";
  weight: number;
  gap_score: number;
}

export interface ResourceOut {
  title: string;
  url: string;
  platform: string;
  last_verified_at: string | null;
  freshness_reason: string | null;
}

export interface SupportingStrength {
  skill_id: string;
  skill_name: string;
  reason: string;
}

export interface KeyGap {
  skill_id: string;
  skill_name: string;
  current_level: number;
  target_level: number;
}

export interface NextStepOut {
  rank: number;
  skill_id: string;
  skill_name: string;
  category: string;
  current_level: number;
  target_level: number;
  action_title: string;
  why: string;
  action_steps: string[];
  acceptance_criteria: string[];
  next_score: number;
  est_weeks: number;
  unblocks: string[];
  blocked_by: string[];
  recommended_resources: ResourceOut[];
  supporting_strengths: SupportingStrength[];
  key_gaps: KeyGap[];
}

export type TimeBudget = "light" | "standard" | "intense";

export interface PacingOut {
  time_budget: TimeBudget;
  weekly_hours: number;
  parallelism: number;
  total_weeks: number;
  summary: string;
}

export interface ResultResponse {
  session_id: string;
  role_id: string;
  orientation: string;
  orientation_label: string | null;
  status: string;
  readiness: number;
  profile_uncertainty: number;
  time_budget: TimeBudget;
  pacing: PacingOut | null;
  profile: SkillProfileOut[];
  strengths: StrengthOut[];
  gaps: GapOut[];
  next_steps: NextStepOut[];
  note: string;
}

// Read the locale cookie on the client so every API call carries the user's
// language as Accept-Language (the backend localizes its response accordingly).
function currentLocaleHeader(): string {
  if (typeof document === "undefined") return "en";
  const m = document.cookie.match(/(?:^|;\s*)ZENO_LOCALE=([^;]+)/);
  const locale = m?.[1] ?? "";
  return locale.startsWith("zh") ? "zh-CN,zh;q=0.9,en;q=0.5" : "en";
}

/** Return the lang query-param value for endpoints that can't receive headers (e.g. EventSource). */
function currentLangParam(): string {
  if (typeof document === "undefined") return "en";
  const m = document.cookie.match(/(?:^|;\s*)ZENO_LOCALE=([^;]+)/);
  const locale = m?.[1] ?? "";
  return locale.startsWith("zh") ? "zh" : "en";
}

/** Read the region cookie (cn | intl) for JD evidence weighting. */
function currentRegionHeader(): string {
  if (typeof document === "undefined") return "intl";
  const m = document.cookie.match(/(?:^|;\s*)ZENO_REGION=([^;]+)/);
  return m?.[1] === "cn" ? "cn" : "intl";
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": currentLocaleHeader(),
      "X-Zeno-Region": currentRegionHeader(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${detail || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface SkillItemOut {
  skill_id: string;
  name: string;
  learnability: number;
}

export interface SkillGroupOut {
  category: string;
  label: string;
  hint: string;
  skills: SkillItemOut[];
}

export interface ProficiencyOptionOut {
  value: string;
  label: string;
  level: number;
}

export interface SkillCatalogResponse {
  groups: SkillGroupOut[];
  proficiency: ProficiencyOptionOut[];
  orientations: OrientationOut[];
}

// --------------------------------------------------------------------------- //
// Assessment plan (Loop 1)
// --------------------------------------------------------------------------- //

export interface TransferSkillOut {
  skill_id: string;
  name: string;
  category: string;
  tier: "direct_transfer" | "adjacent_transfer";
  default_level: number;
  learnability: number;
  reason: string;
}

export interface AssessSkillOut {
  skill_id: string;
  name: string;
  category: string;
  learnability: number;
  weight: number;
  type: "required" | "bonus";
}

export interface SkipSkillOut {
  skill_id: string;
  name: string;
  category: string;
}

export interface AssessmentPlanResponse {
  current_role: string;
  target_role: string;
  transfer_skills: TransferSkillOut[];
  assess_skills: AssessSkillOut[];
  skip_skills: SkipSkillOut[];
}

// --------------------------------------------------------------------------- //
// Experience capsules v3.1 (career transition discovery)
// --------------------------------------------------------------------------- //

export interface SkillMapping {
  skill_id: string;
  base_level: number;
  confidence: number;
}

export interface DepthTierOut {
  id: string; // none | touched | independent | led
  label: string;
  level_offset: number;
}

export interface CapsuleOut {
  id: string;
  text: string;
  capability: string;
  maps_to: SkillMapping[];
  blocked_skill_ids: string[];
}

export interface CategoryOut {
  id: string;
  label: string;
  icon: string;
  hint: string;
  capsules: CapsuleOut[];
}

export interface AiExplorationOut {
  label: string;
  icon: string;
  hint: string;
  capsules: CapsuleOut[];
}

export interface ConfirmProbeOut {
  skill_id: string;
  name: string;
  explain: string;
  options: string[];
  option_levels: number[];
}

export interface ExperienceCapsulesResponse {
  current_role: string;
  depth_tiers: DepthTierOut[];
  categories: CategoryOut[];
  ai_exploration: AiExplorationOut | null;
  confirm_probes: ConfirmProbeOut[];
}

// Offline mode: set NEXT_PUBLIC_USE_MOCK=1 to run the whole flow without the
// API/DB (data comes from lib/mock.ts). Defaults to the real HTTP backend.
const USE_MOCK =
  process.env.NEXT_PUBLIC_USE_MOCK === "1" ||
  process.env.NEXT_PUBLIC_USE_MOCK === "true";

const realApi = {
  createSession: (orientation?: string, currentRole?: string) =>
    http<SessionCreateResponse>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        orientation: orientation ?? null,
        current_role: currentRole ?? null,
      }),
    }),

  paths: () => http<PathsResponse>("/api/paths"),

  skills: (currentRole?: string, targetRole?: string) => {
    const qs = new URLSearchParams();
    if (currentRole) qs.set("current_role", currentRole);
    if (targetRole) qs.set("target_role", targetRole);
    const suffix = qs.toString();
    return http<SkillCatalogResponse>(`/api/skills${suffix ? `?${suffix}` : ""}`);
  },

  assessmentPlan: (currentRole: string, targetRole?: string) => {
    const qs = new URLSearchParams({ current_role: currentRole });
    if (targetRole) qs.set("target_role", targetRole);
    return http<AssessmentPlanResponse>(`/api/assessment-plan?${qs}`);
  },

  experienceCapsules: (currentRole: string) =>
    http<ExperienceCapsulesResponse>(`/api/experience-capsules?current_role=${currentRole}`),

  matchOrientation: (jd: string) =>
    http<JdMatchResponse>("/api/match-orientation", {
      method: "POST",
      body: JSON.stringify({ jd }),
    }),

  nextQuestion: (sessionId: string) =>
    http<NextQuestionResponse>(`/api/sessions/${sessionId}/next-question`),

  submitAnswer: (sessionId: string, skillId: string, answerValue: string) =>
    http<NextQuestionResponse>(`/api/sessions/${sessionId}/answers`, {
      method: "POST",
      body: JSON.stringify({ skill_id: skillId, answer_value: answerValue }),
    }),

  result: (sessionId: string, timeBudget?: TimeBudget, orientation?: string) => {
    const qs = new URLSearchParams();
    if (timeBudget) qs.set("time_budget", timeBudget);
    if (orientation) qs.set("orientation", orientation);
    qs.set("lang", currentLangParam());
    return http<ResultResponse>(
      `/api/sessions/${sessionId}/result?${qs}`,
    );
  },
};

export interface ProgressEvent {
  type: "progress";
  step: string;
  message: string;
}

export interface ResultEvent {
  type: "result";
  data: ResultResponse;
}

export type StreamEvent = ProgressEvent | ResultEvent;

/** Subscribe to SSE result stream. Returns a cleanup function. */
function resultStream(
  sessionId: string,
  onEvent: (event: StreamEvent) => void,
  onError: (err: Error) => void,
  timeBudget?: TimeBudget,
  orientation?: string,
): () => void {
  const qs = new URLSearchParams();
  if (timeBudget) qs.set("time_budget", timeBudget);
  if (orientation) qs.set("orientation", orientation);
  qs.set("lang", currentLangParam());
  const url = `${API_BASE}/api/sessions/${sessionId}/result-stream?${qs}`;

  const evtSource = new EventSource(url);
  evtSource.onmessage = (e) => {
    try {
      const parsed = JSON.parse(e.data) as StreamEvent;
      onEvent(parsed);
      if (parsed.type === "result") {
        evtSource.close();
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error("parse error"));
    }
  };
  evtSource.onerror = () => {
    evtSource.close();
    onError(new Error("Stream connection failed"));
  };

  return () => evtSource.close();
}

// ---------------------------------------------------------------------------
// Story-driven conversational session (v1.1)
// ---------------------------------------------------------------------------

export interface StorySessionResponse {
  session_id: string;
  story_session_id: string;
  followup: string | null;
  done: boolean;
}

const storyApi = {
  /** Start a new session from a free-text project story. */
  startStorySession: (story: string): Promise<StorySessionResponse> =>
    http<StorySessionResponse>("/api/sessions/from-story", {
      method: "POST",
      body: JSON.stringify({ story }),
    }),

  /** Send a follow-up answer and get the next question (or done=true). */
  storyFollowup: (sessionId: string, reply: string): Promise<StorySessionResponse> =>
    http<StorySessionResponse>(`/api/sessions/${sessionId}/story-followup`, {
      method: "POST",
      body: JSON.stringify({ reply }),
    }),
};

const realApiWithStream = {
  ...realApi,
  ...storyApi,
  resultStream,
};

export const api: typeof realApiWithStream = USE_MOCK ? { ...mockApi, ...storyApi, resultStream } : realApiWithStream;
