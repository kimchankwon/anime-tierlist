import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";

export function SignIn() {
  const { signIn } = useAuthActions();
  const [loading, setLoading] = useState(false);

  return (
    <main className="signin">
      <div className="signin-card">
        <h1>Anime Tier Lists</h1>
        <p>
          Sign in with Google to open your own protagonist and antagonist
          boards. Layouts save automatically and stay private to your account.
        </p>
        <button
          type="button"
          className="primary google"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void signIn("google").finally(() => setLoading(false));
          }}
        >
          <GoogleIcon />
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
      />
    </svg>
  );
}
