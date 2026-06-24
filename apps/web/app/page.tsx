"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";

import RotatingText from "@/components/ui/rotating-text";
import { AuroraCss } from "@/components/aurora-css";
import { Starfield } from "@/components/starfield";
import { api, type PathRole } from "@/lib/api";
import { RolePixelIcon } from "@/components/ui/pixel-icons";
import TextType from "@/components/ui/text-type";

/* ---------- star particles (now auto-generated in Starfield component) ---- */

/* ---------- animation variants ------------------------------------------- */

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.09, duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  }),
};

/* ---------- component ---------------------------------------------------- */

export default function HomePage() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // path selector state
  const [currentRoles, setCurrentRoles] = useState<PathRole[]>([]);
  const [targetRoles, setTargetRoles] = useState<PathRole[]>([]);
  const [currentRole, setCurrentRole] = useState("");

  useEffect(() => {
    api.paths().then((data) => {
      setCurrentRoles(data.current_roles);
      setTargetRoles(data.target_roles);
    }).catch(() => {});
  }, []);



  return (
    <main className="relative min-h-screen overflow-x-hidden">
      {/* ── Aurora + Starfield ──────────────────────────────────────── */}
      <AuroraCss />
      <Starfield />

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="container relative z-10 flex min-h-screen flex-col items-center justify-center text-center before:pointer-events-none before:absolute before:inset-0 before:-z-[1] before:rounded-full before:bg-[radial-gradient(ellipse_at_center,rgba(10,15,30,0.4)_0%,transparent_70%)]">
        {/* title */}
        <motion.h1
          custom={0}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-8 cursor-default pb-3 text-6xl font-extrabold leading-[1.3] tracking-tight sm:text-8xl"
        >
          {locale === "en" ? (
            <>
              <RotatingText
                texts={["Discover", "Explore", "Build", "Transform"]}
                mainClassName="text-cyan [-webkit-text-fill-color:hsl(183_86%_52%)] overflow-hidden py-3"
                staggerFrom="last"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "-120%" }}
                staggerDuration={0.025}
                splitLevelClassName="overflow-hidden pb-2"
                transition={{ type: "spring", damping: 30, stiffness: 400 }}
                rotationInterval={2500}
              />{" "}
              <span className="text-gradient">what&apos;s next.</span>
            </>
          ) : (
            <span className="text-gradient">{t("title")}</span>
          )}
        </motion.h1>

        {/* subtitle (static) */}
        <motion.p
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-6 max-w-2xl cursor-default text-xl leading-relaxed text-muted-foreground sm:text-2xl"
        >
          {locale === "en" ? (
            t("subtitle")
          ) : (
            <TextType
              text={t("subtitle")}
              typingSpeed={60}
              initialDelay={600}
              cursorCharacter="▎"
              cursorClassName="ml-0.5 text-cyan/60"
            />
          )}
        </motion.p>

        {/* ── Identity Cards ────────────────────────────────────────── */}
        <motion.div
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-14 w-full max-w-3xl"
        >
          <p className="mb-6 text-center text-lg font-semibold text-foreground/80 sm:text-xl">
            {t("iAmA")}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {currentRoles.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => setCurrentRole(role.id)}
                disabled={loading}
                className={
                  "group relative flex flex-col items-center gap-2 rounded-2xl border border-border/60 bg-card/40 px-4 py-6 backdrop-blur-xl transition-all hover:border-cyan/50 hover:bg-cyan/[0.06] hover:shadow-[0_0_20px_hsl(183_86%_52%/0.1)] active:scale-[0.97] disabled:opacity-60 " +
                  (currentRole === role.id
                    ? "border-cyan/60 bg-cyan/[0.08] shadow-[0_0_20px_hsl(183_86%_52%/0.15)]"
                    : "border-beam")
                }
              >
                <span className="flex h-9 items-center justify-center">
                  <RolePixelIcon roleId={role.id} size={32} />
                </span>
                <span className="text-base font-semibold text-foreground group-hover:text-cyan">
                  {role.label}
                </span>
              </button>
            ))}
          </div>

          {/* Target role (explicit, card style matching above) */}
          <div className="mt-10 flex flex-col items-center gap-3">
            <p className="text-lg font-semibold text-foreground/80 sm:text-xl">{t("targetRole")}</p>
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-cyan/40 bg-cyan/[0.06] px-8 py-5 backdrop-blur-xl">
              <span className="flex h-9 items-center justify-center">
                <Image
                  src="/icons/icon-ai-engineer.png"
                  alt="AI Application Engineer"
                  width={32}
                  height={32}
                  style={{ imageRendering: "pixelated" }}
                  className="pointer-events-none"
                />
              </span>
              <span className="text-base font-semibold text-cyan">
                AI Application Engineer
              </span>
            </div>
          </div>

          {/* CTA Button — always visible, disabled until role selected */}
          <button
            type="button"
            disabled={!currentRole || loading}
            onClick={() => {
              const target = targetRoles[0]?.id || "ai_engineer_applied";
              setLoading(true);
              api.createSession("base", currentRole).then(({ session_id }) => {
                router.push(`/skills?session=${session_id}&current_role=${currentRole}&target_role=${target}`);
              }).catch((e) => {
                setError(e instanceof Error ? e.message : tc("backendDown"));
                setLoading(false);
              });
            }}
            className="mt-8 rounded-full bg-cyan px-8 py-3.5 text-lg font-bold text-[hsl(222_47%_6%)] shadow-[0_0_24px_hsl(183_86%_52%/0.3)] transition-all hover:brightness-110 hover:shadow-[0_0_40px_hsl(183_86%_52%/0.4)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {loading ? t("mapping") : t("cta")}
          </button>

          {error && <p className="mt-3 text-center text-sm text-magenta">{error}</p>}
        </motion.div>

      </section>
    </main>
  );
}





