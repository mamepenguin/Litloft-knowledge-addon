"use client";

import type { ReactNode } from "react";

export function SectionHeading({
  icon,
  children,
  action,
}: {
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-bold text-text-primary">
        {icon}
        {children}
      </h2>
      {action}
    </div>
  );
}
