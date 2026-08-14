import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import { SignIn } from "./SignIn";
import { TierBoard } from "./TierBoard";

export type ListKind = "protagonist" | "antagonist";

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
  const [tab, setTab] = useState<ListKind>("protagonist");

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
          <h1>{tab === "protagonist" ? "Protagonist" : "Antagonist"} Tier List</h1>
          <div className="sub">
            {tab === "protagonist"
              ? "Main protagonists of the top 100 anime both xtectra and Prowtar have watched and scored"
              : "Researched main antagonists from the anime in both xtectra’s and Prowtar’s top 200"}
            {" · "}scores out of 10 · your arrangement auto-saves
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
      </div>
      <TierBoard key={tab} listKind={tab} />
    </>
  );
}
