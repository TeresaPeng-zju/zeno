"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { type QuestionOut } from "@/lib/api";
import { cn } from "@/lib/utils";

const schema = z.object({
  answer_value: z.string().min(1),
});
type FormValues = z.infer<typeof schema>;

export function QuestionCard({
  question,
  submitting,
  onSubmit,
}: {
  question: QuestionOut;
  submitting: boolean;
  onSubmit: (answerValue: string) => void;
}) {
  const t = useTranslations("question");
  const tcat = useTranslations("categories");
  const {
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { answer_value: "" },
  });

  // Reset selection whenever a new question arrives.
  useEffect(() => {
    reset({ answer_value: "" });
  }, [question.question_id, reset]);

  const selected = watch("answer_value");

  return (
    <form onSubmit={handleSubmit((v) => onSubmit(v.answer_value))} className="space-y-6">
      <div className="space-y-2">
        <span className="inline-block rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
          {tcat.has(question.category) ? tcat(question.category) : question.category}
        </span>
        <h2 className="text-2xl font-semibold leading-snug">{question.text}</h2>
        <p className="text-sm text-muted-foreground">{question.help_text}</p>
      </div>

      <div className="grid gap-3">
        {question.options.map((opt) => {
          const active = selected === opt.value;
          return (
            <button
              type="button"
              key={opt.value}
              onClick={() =>
                setValue("answer_value", opt.value, { shouldValidate: true })
              }
              className={cn(
                "flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                active
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-input hover:bg-accent",
              )}
            >
              <span>{opt.label}</span>
              <span
                className={cn(
                  "h-4 w-4 shrink-0 rounded-full border",
                  active ? "border-primary bg-primary" : "border-muted-foreground/40",
                )}
              />
            </button>
          );
        })}
      </div>

      {errors.answer_value && (
        <p className="text-sm text-red-500">{t("pickOption")}</p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={submitting || !selected}>
        {submitting ? t("submitting") : t("next")}
      </Button>
    </form>
  );
}
