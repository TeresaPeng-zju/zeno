from pydantic import BaseModel, Field


class SessionCreateResponse(BaseModel):
    session_id: str
    role_id: str


class OptionOut(BaseModel):
    value: str
    label: str


class SkillItemOut(BaseModel):
    skill_id: str
    name: str
    learnability: float


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
    unblocks: list[str] = Field(default_factory=list)
    blocked_by: list[str] = Field(default_factory=list)
    recommended_resources: list[ResourceOut] = Field(default_factory=list)


class ResultResponse(BaseModel):
    session_id: str
    role_id: str
    status: str
    readiness: float  # 0-100 weighted coverage of required skills
    # Section 0: raw profile (kept for the 画像 view)
    profile: list[SkillProfileOut]
    # Three-section decision output (plan 6.3)
    strengths: list[StrengthOut]
    gaps: list[GapOut]
    next_steps: list[NextStepOut]
    note: str
