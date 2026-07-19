from pydantic import BaseModel, Field


class SessionCreateRequest(BaseModel):
    orientation: str | None = Field(
        default=None, description="Target orientation modifier, e.g. 'base' | 'rag'."
    )
    current_role: str | None = Field(
        default=None,
        description="User's current role id (e.g. 'frontend_engineer'). "
        "Used for path-based skill assessment filtering.",
    )


class SessionCreateResponse(BaseModel):
    session_id: str
    role_id: str
    orientation: str = "base"
    current_role: str | None = None


class OrientationOut(BaseModel):
    id: str
    label: str
    description: str


class JdMatchRequest(BaseModel):
    jd: str = Field(..., description="Pasted job description text to classify.")


class JdMatchResponse(BaseModel):
    """Result of inferring a target orientation from a pasted JD."""

    orientation: str  # detected orientation id ('base' when nothing stands out)
    orientation_label: str
    description: str
    matched: bool  # True when grounded evidence supports a specialty suggestion
    signals: list[str] = Field(
        default_factory=list, description="Verbatim JD evidence supporting the suggestion."
    )
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    needs_confirmation: bool = False


class OptionOut(BaseModel):
    value: str
    label: str
    example: str | None = None


class SkillItemOut(BaseModel):
    skill_id: str
    name: str
    learnability: float
    layer: str = ""
    ai_usage: list[str] = Field(default_factory=list)
    non_ai_boundaries: list[str] = Field(default_factory=list)


class SkillGroupOut(BaseModel):
    category: str
    label: str
    hint: str
    skills: list[SkillItemOut]


class ProficiencyOptionOut(BaseModel):
    value: str
    label: str
    level: int


class SkillCatalogResponse(BaseModel):
    groups: list[SkillGroupOut]
    proficiency: list[ProficiencyOptionOut]
    orientations: list[OrientationOut] = Field(default_factory=list)


class Progress(BaseModel):
    answered: int
    max: int


class QuestionOut(BaseModel):
    question_id: str
    skill_id: str
    category: str
    text: str
    help_text: str
    ui_type: str = "single_select"
    options: list[OptionOut]
    progress: Progress


class NextQuestionResponse(BaseModel):
    result_ready: bool
    question: QuestionOut | None = None


class AnswerIn(BaseModel):
    skill_id: str
    answer_value: str = Field(..., description="Must be one of the fixed option values")
    question_id: str | None = None
    answer_source: str = Field(default="standard", pattern="^(standard|user_correction)$")


class CorrectionAnalyzeIn(BaseModel):
    skill_id: str
    text: str = Field(min_length=12, max_length=3000)


class CorrectionEvidenceOut(BaseModel):
    evidence_id: str
    skill_id: str
    project: str = ""
    actions: list[str] = Field(default_factory=list)
    ownership: str = ""
    outcome: str = ""
    evidence_quote: str = ""
    llm_suggested_level: int | None = None
    rule_level: int
    rule_version: str
    current_level: int
    provider: str


class CorrectionConfirmIn(BaseModel):
    evidence_id: str
    action: str = Field(pattern="^(confirm|keep)$")


class CorrectionConfirmOut(BaseModel):
    status: str
    level: int


class SkillProfileOut(BaseModel):
    skill_id: str
    skill_name: str
    category: str
    level: int
    confidence: float


class StrengthOut(BaseModel):
    skill_id: str
    skill_name: str
    category: str
    level: int
    reason: str
    ai_usage: list[str] = Field(default_factory=list)
    non_ai_boundaries: list[str] = Field(default_factory=list)


class GapOut(BaseModel):
    skill_id: str
    skill_name: str
    category: str
    current_level: int
    target_level: int
    gap: int
    type: str  # required | bonus
    weight: float
    gap_score: float


class ResourceOut(BaseModel):
    """Resource prescription — populated by the Resource Engine in Week 3."""

    title: str
    url: str
    platform: str
    last_verified_at: str | None = None
    freshness_reason: str | None = None
    ai_curated: bool = False


class NextStepOut(BaseModel):
    rank: int
    skill_id: str
    skill_name: str
    category: str
    current_level: int
    target_level: int
    action_title: str
    why: str
    action_steps: list[str]
    acceptance_criteria: list[str]
    next_score: float
    est_weeks: int = 0
    unblocks: list[str] = Field(default_factory=list)
    blocked_by: list[str] = Field(default_factory=list)
    recommended_resources: list[ResourceOut] = Field(default_factory=list)
    ranking_reasons: list[str] = Field(default_factory=list)
    score_components: dict[str, float] | None = Field(
        default=None,
        description="Auditable score breakdown. Only present when FEATURE_SCORE_COMPONENTS_API=true.",
    )


class PacingOut(BaseModel):
    """Result-page time-budget calibration (expression layer, deterministic)."""

    time_budget: str  # light | standard | intense
    weekly_hours: int
    parallelism: int
    total_weeks: int
    summary: str


class SkillObservationIn(BaseModel):
    skill_id: str
    level: int = Field(..., ge=0, le=4)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class ExplainRequest(BaseModel):
    """Self-contained (DB-free) explain request — feed a profile, get the chain."""

    observations: list[SkillObservationIn]
    orientation: str | None = None
    max_steps: int = Field(default=3, ge=1, le=50)


class PlanDiffRequest(BaseModel):
    observations_before: list[SkillObservationIn]
    observations_after: list[SkillObservationIn]
    orientation: str | None = None
    max_steps: int = Field(default=3, ge=1, le=50)


class ResultResponse(BaseModel):
    session_id: str
    role_id: str
    orientation: str = "base"
    orientation_label: str | None = None
    status: str
    readiness: float  # 0-100 weighted coverage of required skills
    projected_readiness: float  # coverage after completing the current roadmap
    profile_uncertainty: float = Field(ge=0.0, le=1.0)
    assessed_required_count: int = Field(ge=0)
    required_skill_count: int = Field(ge=0)
    time_budget: str = "standard"
    pacing: PacingOut | None = None
    # Section 0: raw profile (kept for the 画像 view)
    profile: list[SkillProfileOut]
    # Three-section decision output (plan 6.3)
    strengths: list[StrengthOut]
    gaps: list[GapOut]
    next_steps: list[NextStepOut]
    note: str


# --------------------------------------------------------------------------- #
# Assessment plan (Loop-1 migration assessment)
# --------------------------------------------------------------------------- #


class TransferSkillOut(BaseModel):
    """A skill the user likely already has from their current role."""

    skill_id: str
    name: str
    category: str
    tier: str  # direct_transfer | adjacent_transfer
    default_level: int
    learnability: float
    reason: str


class AssessSkillOut(BaseModel):
    """A skill the user needs to self-evaluate — a core gap for the target role."""

    skill_id: str
    name: str
    category: str
    learnability: float
    weight: float  # importance in the target role
    type: str  # required | bonus


class SkipSkillOut(BaseModel):
    """A skill excluded from the first-pass assessment."""

    skill_id: str
    name: str
    category: str


class AssessmentPlanResponse(BaseModel):
    """Structured migration assessment plan — the engine of Loop 1."""

    current_role: str
    target_role: str
    transfer_skills: list[TransferSkillOut]
    assess_skills: list[AssessSkillOut]
    skip_skills: list[SkipSkillOut]


# --------------------------------------------------------------------------- #
# Experience capsules v3.1 (Loop-1 UX — career transition discovery)
# --------------------------------------------------------------------------- #


class SkillMapping(BaseModel):
    skill_id: str
    base_level: int
    confidence: float


class DepthTierOut(BaseModel):
    id: str  # none | touched | independent | led
    label: str
    level_offset: int


class CapsuleOut(BaseModel):
    """A single observable behavior in user language."""

    id: str
    text: str
    capability: str  # human-readable transferable capability name
    maps_to: list[SkillMapping]


class CategoryOut(BaseModel):
    """An experience category (e.g. 'What I've built and shipped')."""

    id: str
    label: str
    icon: str
    hint: str  # decision-oriented explanation
    capsules: list[CapsuleOut]


class AiExplorationOut(BaseModel):
    """Optional AI exploration section (start-point calibrator)."""

    label: str
    icon: str
    hint: str
    capsules: list[CapsuleOut]


class ConfirmProbeOut(BaseModel):
    """Extreme-short AI-specific probe with pre-defined options."""

    skill_id: str
    name: str
    explain: str
    options: list[str]
    option_levels: list[int]


class ExperienceCapsulesResponse(BaseModel):
    """v3.1: category-based capsules + depth tiers + AI probes."""

    current_role: str
    depth_tiers: list[DepthTierOut]
    categories: list[CategoryOut]
    ai_exploration: AiExplorationOut | None = None
    confirm_probes: list[ConfirmProbeOut]
