import { lazy } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const slotComponents: Record<string, React.LazyExoticComponent<React.ComponentType<any>>> = {
  "knowledge-edit": lazy(() => import("./KnowledgeEditSection")),
  "knowledge-active-summary": lazy(() => import("./ActiveSummarySection")),
  "knowledge-capture-basket": lazy(() => import("./CaptureBasket")),
  "knowledge-media-capture": lazy(() => import("./MediaCaptureAction")),
  "knowledge-create-note": lazy(() => import("./CreateNoteMenuItem")),
  "knowledge-version-history": lazy(() => import("./VersionHistoryMenuItem")),
  "knowledge-search-capture": lazy(() => import("./SearchCaptureActions")),
};
