"use client";

import { useTranslations } from "next-intl";

import ClipShelf from "./ClipShelf";
import { loadNewClips, loadRecentlyOpened, loadUnread, loadUnverified } from "./requests";

interface Props {
  drive: string;
  now: Date;
  withProfile: boolean;
  visible: boolean;
  refreshToken: number;
  onViewerRequired: () => void;
}

export default function ClipsHome({
  drive,
  now,
  withProfile,
  visible,
  refreshToken,
  onViewerRequired,
}: Props) {
  const t = useTranslations("knowledge.clips");
  const shelf = {
    drive,
    now,
    visible,
    refreshToken,
    onViewerRequired,
  };

  return (
    <>
      {withProfile ? (
        <ClipShelf key="unread" title={t("shelf.unread")} load={loadUnread} {...shelf} />
      ) : (
        <ClipShelf key="new" title={t("shelf.newClips")} load={loadNewClips} {...shelf} />
      )}
      {withProfile && (
        <ClipShelf key="recent" title={t("shelf.recentlyOpened")} load={loadRecentlyOpened} {...shelf} />
      )}
      <ClipShelf key="unverified" title={t("shelf.unverified")} load={loadUnverified} {...shelf} />
    </>
  );
}
