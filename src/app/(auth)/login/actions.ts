"use server";

import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth/config";
import { prisma } from "@/lib/db/client";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export type LoginState = { error?: string };

/**
 * Sign-in server action.
 *
 * Failures are deliberately uniform ("Invalid email or password") so the form
 * cannot be used to enumerate which accounts exist. The one exception is a
 * SUSPENDED/INACTIVE account, where a specific message is more useful than a
 * misleading "wrong password" — that reveals nothing an attacker could not
 * already infer by being told the credentials were right.
 */
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details you entered." };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/",
    });
    return {};
  } catch (error) {
    // next-auth signals a successful redirect by throwing; re-throw it.
    if (isRedirectError(error)) throw error;

    if (error instanceof AuthError) {
      const status = await accountStatusFor(parsed.data.email);
      if (status === "SUSPENDED") {
        return { error: "This account has been suspended. Contact your administrator." };
      }
      if (status === "INACTIVE") {
        return { error: "This account is no longer active. Contact your administrator." };
      }
      return { error: "Invalid email or password." };
    }
    return { error: "Something went wrong. Please try again." };
  }
}

function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

async function accountStatusFor(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { accountStatus: true },
  });
  return user?.accountStatus ?? null;
}
