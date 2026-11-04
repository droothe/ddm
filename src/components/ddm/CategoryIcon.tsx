import { FileArchive, FileAudio, FileCode2, FileVideo, File } from "lucide-react";
import type { Category } from "@/lib/ddm-store";

export function CategoryIcon({ category, className }: { category: Category; className?: string }) {
  const I = { video: FileVideo, archive: FileArchive, executable: FileCode2, audio: FileAudio, other: File }[category];
  return <I className={className} />;
}
