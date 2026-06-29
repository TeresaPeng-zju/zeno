"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { Centered } from "@/components/site/centered";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

type Item = { skill_name: string };
type Gap = { skill_name: string; type: string; gap: number };

function GrowthInner() {
  const params = useSearchParams();
  const sessionId = params.get("session");
  const locale = useLocale();
  const t = useTranslations("growth");
  const tRoles = useTranslations("roles");
  const [strengths, setStrengths] = useState<Item[]>([]);
  const [needs, setNeeds] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`${API}/api/sessions/${sessionId}/result?lang=${locale}`)
      .then((r) => r.json())
      .then((d) => {
        setStrengths((d.strengths ?? []).map((s: Item) => ({ skill_name: s.skill_name })));
        setNeeds((d.gaps ?? []).filter((g: Gap) => g.type === "required" && g.gap > 0).slice(0, 5).map((g: Gap) => ({ skill_name: g.skill_name })));
      })
      .catch(() => { /* 非致命：拿不到就显示空 */ })
      .finally(() => setLoading(false));
  }, [sessionId, locale]);

  if (!sessionId) return <Centered text={t("missing")} tone="error" minHeight="100vh" />;
  if (loading) return <Centered text={t("loading")} minHeight="100vh" />;

  const PATH = [t("pathCurrent"), tRoles("aiEngineer"), t("pathTarget")];

  return (
    <main className="container relative max-w-2xl py-16">
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-72" />
      <div className="relative space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* 纵向路径 */}
      <div className="relative mt-10 flex flex-col items-center gap-3">
        {PATH.map((p, i) => (
          <div key={p} className="flex flex-col items-center gap-3">
            <div className={"rounded-2xl border px-6 py-3 text-center backdrop-blur " +
              (i === 0 ? "border-cyan/60 bg-cyan/[0.06] text-cyan"
                : i === 1 ? "border-gold/60 bg-gold/[0.06] text-gold"
                : "border-border/60 bg-card/40 text-muted-foreground")}>
              <p className="text-sm font-semibold">{p}</p>
              {i === 0 && <p className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{t("youAreHere")}</p>}
              {i === 1 && <p className="mt-0.5 text-[10px] uppercase tracking-widest text-gold/70">{t("next")}</p>}
            </div>
            {i < PATH.length - 1 && <span className="text-muted-foreground">↓</span>}
          </div>
        ))}
      </div>

      {/* 已有 / 待补 */}
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-cyan/25 bg-cyan/[0.04] p-5">
          <p className="mb-3 text-sm font-semibold text-cyan">{t("haveTitle")}</p>
          <div className="flex flex-wrap gap-2">
            {strengths.length > 0 ? strengths.map((s) => (
              <span key={s.skill_name} className="rounded-full border border-cyan/30 bg-card/40 px-3 py-1 text-xs text-foreground/90">{s.skill_name}</span>
            )) : <span className="text-xs text-muted-foreground">—</span>}
          </div>
        </div>
        <div className="rounded-2xl border border-magenta/25 bg-magenta/[0.04] p-5">
          <p className="mb-3 text-sm font-semibold text-magenta">{t("needTitle")}</p>
          <div className="flex flex-wrap gap-2">
            {needs.length > 0 ? needs.map((n) => (
              <span key={n.skill_name} className="rounded-full border border-magenta/30 bg-card/40 px-3 py-1 text-xs text-foreground/90">{n.skill_name}</span>
            )) : <span className="text-xs text-muted-foreground">—</span>}
          </div>
        </div>
      </div>

      <div className="mt-10 text-center">
        <a href={`/result?session=${sessionId}`} className="inline-block rounded-full border border-border/60 px-6 py-2.5 text-sm text-foreground transition-colors hover:border-cyan/40 hover:text-cyan">
          {t("back")}
        </a>
      </div>
    </main>
  );
}

export default function GrowthPage() {
  const t = useTranslations("growth");
  return (
    <Suspense fallback={<Centered text={t("loading")} minHeight="100vh" />}>
      <GrowthInner />
    </Suspense>
  );
}
