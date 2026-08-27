import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db/client";

/**
 * Auth.js v5 configuration.
 *
 * Password verification is delegated to bcrypt via a vetted library rather than
 * hand-rolled crypto (§4). Sessions are JWT-backed HttpOnly cookies (§63).
 *
 * IMPORTANT: the session token carries identity ONLY (user id). Roles,
 * account status and venture memberships are re-read from the database on every
 * request by resolveActor() — never trusted from the token, so revoking access
 * takes effect immediately rather than at next login (§53).
 */

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 }, // 8h, §63 session expiration
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase().trim() },
          select: { id: true, passwordHash: true, accountStatus: true },
        });

        // Uniform failure for unknown email and wrong password, so the response
        // does not reveal which accounts exist.
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        // SUSPENDED/INACTIVE cannot hold a session at all. PENDING may sign in
        // so it can see the "awaiting approval" screen (§7); every business
        // route still refuses it via the guard.
        if (user.accountStatus === "SUSPENDED" || user.accountStatus === "INACTIVE") {
          return null;
        }

        return { id: user.id };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
