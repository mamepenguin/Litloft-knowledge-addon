"use client";

import { Newspaper } from "lucide-react";

export default function ClipsEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-center">
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-2xl bg-bg-elevated text-warm-silver"
      >
        <Newspaper size={26} strokeWidth={1.6} />
      </span>
      <p className="text-[15px] font-semibold text-text-primary">{title}</p>
      <p className="max-w-[26rem] text-[13px] leading-relaxed text-text-muted">{body}</p>
    </div>
  );
}
