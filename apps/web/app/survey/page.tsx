"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { QuestionCard } from "@/components/question-card";
import { Centered } from "@/components/site/centered";
import { api, type QuestionOut } from "@/lib/api";

function SurveyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session");

  const [question, setQuestion] = useState<QuestionOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const finish = useCallback(() => {
    router.push(`/result?session=${sessionId}`);
  }, [router, sessionId]);

  const loadNext = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await api.nextQuestion(sessionId);
      if (res.result_ready || !res.question) {
        finish();
        return;
      }
      setQuestion(res.question);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setLoading(false);
    }
  }, [sessionId, finish]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!sessionId) {
      setError("缺少 session 参数");
      setLoading(false);
      return;
    }
    void loadNext();
  }, [sessionId, loadNext]);

  async function handleSubmit(answerValue: string) {
    if (!sessionId || !question) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.submitAnswer(sessionId, question.skill_id, answerValue);
      if (res.result_ready || !res.question) {
        finish();
        return;
      }
      setQuestion(res.question);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <Centered text="正在准备你的第一道问题..." minHeight="100vh" />;
  }
  if (error) {
    return <Centered text={error} tone="error" minHeight="100vh" />;
  }
  if (!question) {
    return <Centered text="没有更多问题了。" minHeight="100vh" />;
  }

  const { answered, max } = question.progress;

  return (
    <main className="container flex min-h-screen flex-col items-center justify-center py-12">
      <div className="w-full max-w-xl space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>能力评估</span>
            <span>
              第 {answered + 1} 题 · 最多 {max} 题
            </span>
          </div>
          <Progress value={answered} max={max} />
        </div>

        <Card>
          <CardContent className="pt-6">
            <QuestionCard
              question={question}
              submitting={submitting}
              onSubmit={handleSubmit}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function CenteredNote({ text, tone }: { text: string; tone?: "error" }) {
  return (
    <main className="container flex min-h-screen items-center justify-center">
      <p className={tone === "error" ? "text-red-500" : "text-muted-foreground"}>{text}</p>
    </main>
  );
}

export default function SurveyPage() {
  return (
    <Suspense fallback={<Centered text="加载中..." minHeight="100vh" />}>
      <SurveyInner />
    </Suspense>
  );
}
