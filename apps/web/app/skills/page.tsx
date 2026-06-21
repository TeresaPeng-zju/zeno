"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Centered } from "@/components/site/centered";
import {
  api,
  type ProficiencyOptionOut,
  type SkillCatalogResponse,
  type SkillItemOut,
} from "@/lib/api";

type Selections = Record<string, string>; // skill_id -> answer value

function levelTone(level: number): { ring: string; dot: string; text: string } {
  if (level >= 3) return { ring: "border-cyan/70 bg-cyan/10", dot: "bg-cyan", text: "text-cyan" };
  if (level === 2) return { ring: "border-gold/70 bg-gold/10", dot: "bg-gold", text: "text-gold" };
  return { ring: "border-magenta/60 bg-magenta/10", dot: "bg-magenta", text: "text-magenta" };
}

function SkillsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations("skills");
  const tc = useTranslations("common");
  const [sessionId, setSessionId] = useState<string | null>(params.get("session"));
  const [catalog, setCatalog] = useState<SkillCatalogResponse | null>(null);
  const [selections, setSelections] = useState<Selections>({});
  const [active, setActive] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ensure a session exists, then load the skill catalog.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let sid = sessionId;
        if (!sid) {
          const created = await api.createSession();
          sid = created.session_id;
          if (!cancelled) setSessionId(sid);
        }
        const cat = await api.skills();
        if (!cancelled) setCatalog(cat);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : tc("backendDown"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const profByValue = useMemo(() => {
    const m: Record<string, ProficiencyOptionOut> = {};
    catalog?.proficiency.forEach((p) => (m[p.value] = p));
    return m;
  }, [catalog]);

  const selectedCount = Object.keys(selections).length;

  function choose(skillId: string, value: string) {
    setSelections((s) => ({ ...s, [skillId]: value }));
    setActive(null);
  }

  async function generate() {
    if (!sessionId || selectedCount === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      for (const [skillId, value] of Object.entries(selections)) {
        await api.submitAnswer(sessionId, skillId, value);
      }
      router.push(`/result?session=${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("submitFailed"));
      setSubmitting(false);
    }
  }

  if (error && !catalog) return <Centered text={error} tone="error" />;
  if (!catalog) return <Centered text={t("preparing")} />;

  return (
    <main className="container relative max-w-4xl py-14">
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-72" />
      <div className="relative space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      <div className="relative mt-10 space-y-8">
        {catalog.groups.map((group) => (
          <section key={group.category}>
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-base font-semibold">{group.label}</h2>
              <span className="text-xs text-muted-foreground">{group.hint}</span>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {group.skills.map((skill) => (
                <Capsule
                  key={skill.skill_id}
                  skill={skill}
                  value={selections[skill.skill_id]}
                  level={selections[skill.skill_id] ? profByValue[selections[skill.skill_id]]?.level ?? 0 : null}
                  expanded={active === skill.skill_id}
                  proficiency={catalog.proficiency}
                  onToggle={() =>
                    setActive((a) => (a === skill.skill_id ? null : skill.skill_id))
                  }
                  onChoose={(v) => choose(skill.skill_id, v)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* sticky action bar */}
      <div className="sticky bottom-5 z-30 mt-12">
        <div className="hairline mx-auto flex max-w-2xl items-center justify-between gap-4 rounded-2xl bg-card/85 px-5 py-3 backdrop-blur-xl">
          <p className="text-sm text-muted-foreground">
            {t.rich("selectedCount", {
              count: selectedCount,
              c: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
            })}
            {selectedCount === 0 && t("pickAtLeastOne")}
          </p>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-magenta">{error}</span>}
            <Button onClick={generate} disabled={submitting || selectedCount === 0}>
              {submitting ? t("generating") : t("generatePath")}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}

function Capsule({
  skill,
  value,
  level,
  expanded,
  proficiency,
  onToggle,
  onChoose,
}: {
  skill: SkillItemOut;
  value?: string;
  level: number | null;
  expanded: boolean;
  proficiency: ProficiencyOptionOut[];
  onToggle: () => void;
  onChoose: (v: string) => void;
}) {
  const tone = level != null ? levelTone(level) : null;
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={
          "flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-all " +
          (tone
            ? `${tone.ring} ${tone.text}`
            : "border-border bg-surface/60 text-foreground hover:border-primary/50 hover:bg-surface")
        }
      >
        {tone && <span className={"h-1.5 w-1.5 rounded-full " + tone.dot} />}
        <span className="font-medium">{skill.name}</span>
        {value && (
          <span className="text-xs opacity-80">
            · {proficiency.find((p) => p.value === value)?.label.replace(/ \/.*/, "")}
          </span>
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="hairline absolute left-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl"
          >
            {proficiency.map((p) => (
              <button
                key={p.value}
                onClick={() => onChoose(p.value)}
                className={
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent " +
                  (value === p.value ? "bg-accent" : "")
                }
              >
                <span>{p.label}</span>
                <span className="text-[10px] text-muted-foreground">L{p.level}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function SkillsPage() {
  const tc = useTranslations("common");
  return (
    <Suspense fallback={<Centered text={tc("loading")} />}>
      <SkillsInner />
    </Suspense>
  );
}
