import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    signIn({ profile }) {
      const allowed = (process.env.ALLOWED_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      const email = profile?.email?.toLowerCase();
  
      return !!profile?.email_verified && !!email && allowed.includes(email);
    },
  },
});