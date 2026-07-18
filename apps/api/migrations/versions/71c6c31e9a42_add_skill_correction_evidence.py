"""add skill correction evidence

Revision ID: 71c6c31e9a42
Revises: 2f6d41b13c8a
"""
from alembic import op
import sqlalchemy as sa

revision = "71c6c31e9a42"
down_revision = "2f6d41b13c8a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "skill_correction_evidence",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("skill_id", sa.String(), nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column("extraction", sa.JSON(), nullable=False),
        sa.Column("llm_suggested_level", sa.Integer(), nullable=True),
        sa.Column("rule_level", sa.Integer(), nullable=False),
        sa.Column("rule_version", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("confirmed_level", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_skill_correction_evidence_session_id", "skill_correction_evidence", ["session_id"])
    op.create_index("ix_skill_correction_evidence_skill_id", "skill_correction_evidence", ["skill_id"])


def downgrade() -> None:
    op.drop_index("ix_skill_correction_evidence_skill_id", table_name="skill_correction_evidence")
    op.drop_index("ix_skill_correction_evidence_session_id", table_name="skill_correction_evidence")
    op.drop_table("skill_correction_evidence")
