import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-screen place-items-center bg-stone-100 p-6 text-stone-900">
      <div className="w-full max-w-sm space-y-3 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Belépés</h1>
        <p className="text-sm leading-6 text-stone-600">A mentett beállítások a fiókodhoz tartoznak. Mások a saját listájukat látják.</p>
        {authEnabled ? (
          GROK_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
              className="w-full cursor-pointer rounded-lg border border-stone-900 px-4 py-2 text-sm font-semibold hover:bg-stone-100"
            >
              Belépés: {provider.label}
            </button>
          ))
        ) : (
          <p className="text-sm text-stone-500">A belépés ki van kapcsolva.</p>
        )}
        <Link to="/" className="block text-center text-sm text-stone-500 underline">
          Vissza a padlóhoz
        </Link>
      </div>
    </main>
  );
}
