"use client";

import { useTranslations } from "next-intl";

import { PageTabs } from "@/components/PageTabs";

export default function ClipsTabs({ pathname, all }: { pathname: string; all: boolean }) {
  const t = useTranslations("knowledge.clips");

  return (
    <div className="mt-4">
      <PageTabs
        label={t("tabsLabel")}
        current={all ? "all" : "home"}
        items={[
          { key: "home", label: t("home"), href: pathname },
          { key: "all", label: t("all"), href: `${pathname}?view=all` },
        ]}
      />
    </div>
  );
}
