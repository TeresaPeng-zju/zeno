"""add resource candidate review queue

Revision ID: 2f6d41b13c8a
Revises: 995070c43545
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "2f6d41b13c8a"
down_revision = "995070c43545"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resource_candidates",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("url", sa.String(), nullable=False),
        sa.Column("url_hash", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("fetched_text", sa.Text(), nullable=True),
        sa.Column("annotation", sa.JSON(), nullable=True),
        sa.Column("model_name", sa.String(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'failed')",
            name="ck_resource_candidate_status",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_resource_candidates_status", "resource_candidates", ["status"])
    op.create_index("ix_resource_candidates_url_hash", "resource_candidates", ["url_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_resource_candidates_url_hash", table_name="resource_candidates")
    op.drop_index("ix_resource_candidates_status", table_name="resource_candidates")
    op.drop_table("resource_candidates")
