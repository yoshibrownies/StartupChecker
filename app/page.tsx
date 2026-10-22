import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import ChatApp from "@/components/chat-app";

async function AuthedChat() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <ChatApp
      userName={session.user.name ?? session.user.email ?? "Signed in"}
      signOutAction={logout}
      testMode={process.env.ENABLE_TEST_FAULTS === "true"}
    />
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-sm text-zinc-500">
          Loading…
        </div>
      }
    >
      <AuthedChat />
    </Suspense>
  );
}