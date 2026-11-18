/** SPEC-ADDON-130: New note is the app header's primary action, not one of its actions. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";

const header = vi.hoisted(() => ({ props: null as null | { primaryAction?: ReactNode; actions?: ReactNode } }));
vi.mock("@/components/appshell/AppHeader", () => ({
  AppHeader: (props: { primaryAction?: ReactNode; actions?: ReactNode }) => {
    header.props = props;
    return <header>{props.primaryAction}{props.actions}</header>;
  },
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (ns?: string) => (key: string) => `${ns ?? ""}.${key}`,
}));
vi.mock("@/components/CurrentDriveProvider", () => ({ useCurrentDrive: () => "d" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/drive/d/addons/knowledge",
}));
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => ({ nickname: null, setNickname: vi.fn(), clearNickname: vi.fn() }),
}));
vi.mock("@/components/quick-note", () => ({ useQuickNote: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/api", async () => ({
  ...(await vi.importActual<object>("@/lib/api")),
  getDriveFiles: vi.fn(() => new Promise(() => {})),
  getWatchHistory: vi.fn(() => new Promise(() => {})),
  getSmartFolders: vi.fn(async () => []),
  getCollections: vi.fn(async () => []),
}));
vi.mock("../library/NotesLibrary", () => ({ default: () => null }));

const NotesPage = (await import("../NotesPage")).default;

describe("SPEC-ADDON-130 the header's primary action", () => {
  afterEach(cleanup);

  it("passes New note as primaryAction and no actions", () => {
    render(<NotesPage />);

    expect(header.props?.primaryAction).toBeTruthy();
    expect(header.props?.actions).toBeUndefined();
  });
});
