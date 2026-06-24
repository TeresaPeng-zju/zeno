/**
 * Pixel-art role icons for identity cards.
 * Uses pre-generated PNG assets from /icons/ directory.
 */
import Image from "next/image";

const ROLE_ICONS: Record<string, { src: string; alt: string }> = {
  frontend_engineer: { src: "/icons/icon-frontend.png", alt: "Frontend Engineer" },
  backend_engineer: { src: "/icons/icon-backend.png", alt: "Backend Engineer" },
  fullstack_engineer: { src: "/icons/icon-fullstack.png", alt: "Fullstack Engineer" },
  student: { src: "/icons/icon-student.png", alt: "Student" },
};

/** Map role ID to pixel icon */
export function RolePixelIcon({ roleId, size = 32 }: { roleId: string; size?: number }) {
  const icon = ROLE_ICONS[roleId];
  if (!icon) return null;

  return (
    <Image
      src={icon.src}
      alt={icon.alt}
      width={size}
      height={size}
      className="pointer-events-none"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
