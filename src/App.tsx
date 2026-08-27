import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import { NineGrids } from "./NineGrid";
import { SignIn } from "./SignIn";
import { TierBoard } from "./TierBoard";

export type ListKind = "protagonist" | "antagonist";
type Tab = ListKind | "nine";

const HEADINGS: Record<Tab, { title: string; sub: string }> = {
  protagonist: {
    title: "Protagonist Tier List",
    sub: "Main protagonists of the top 100 anime both xtectra and Prowtar have watched and scored",
  },
  antagonist: {
    title: "Antagonist Tier List",
    sub: "Researched main antagonists from the anime in both xtectra’s and Prowtar’s top 200",
  },
  nine: {
    title: "3x3",
    sub: "Nine picks of your own — search anime and characters or bring your own pictures",
  },
};

export default function App() {
  return (
    <>
      <AuthLoading>
        <div className="loading">Loading…</div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <Shell />
      </Authenticated>
    </>
  );
}

function Shell() {
  const me = useQuery(api.users.me);
  const { signOut } = useAuthActions();
  const [tab, setTab] = useState<Tab>("protagonist");

  const initials = (me?.name ?? me?.email ?? "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <>
      <header className="app-header">
        <div>
          <h1>{HEADINGS[tab].title}</h1>
          <div className="sub">
            {HEADINGS[tab].sub}
            {tab === "nine"
              ? " · titled and saved to your collection · view your friends’ 3x3s"
              : " · scores out of 10 · your arrangement auto-saves · view or compare others"}
          </div>
        </div>
        <div className="user-chip">
          <div className="user-meta">
            <div className="name">{me?.name ?? "Signed in"}</div>
            <div className="email">{me?.email}</div>
          </div>
          {me?.image ? (
            <img src={me.image} alt="" />
          ) : (
            <div className="user-fallback">{initials}</div>
          )}
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <div className="tabs" role="tablist">
        <button
          type="button"
          className={tab === "protagonist" ? "tab active" : "tab"}
          onClick={() => setTab("protagonist")}
        >
          Protagonists
        </button>
        <button
          type="button"
          className={tab === "antagonist" ? "tab active" : "tab"}
          onClick={() => setTab("antagonist")}
        >
          Antagonists
        </button>
        <button
          type="button"
          className={tab === "nine" ? "tab active" : "tab"}
          onClick={() => setTab("nine")}
        >
          3x3
        </button>
      </div>
      {tab === "nine" ? <NineGrids /> : <TierBoard key={tab} listKind={tab} />}
    </>
  );
}
