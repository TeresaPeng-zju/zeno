/**
 * Shared full-screen centered message (loading / error states).
 * Replaces the three near-identical copies that used to live in the
 * survey / skills / result pages.
 */
export function Centered({
  text,
  tone,
  minHeight = "60vh",
  children,
}: {
  text: string;
  tone?: "error";
  minHeight?: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="container flex flex-col items-center justify-center text-center" style={{ minHeight }}>
      <p className={tone === "error" ? "text-magenta" : "text-muted-foreground"}>{text}</p>
      {children}
    </main>
  );
}
