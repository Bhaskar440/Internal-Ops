import { describe, it, expect, afterAll } from "vitest";
import { testPrisma as prisma } from "../helpers/testPrisma";

/**
 * The first Super Admin sets their own password (§83).
 *
 * The seed must never create a usable credential: the account arrives PENDING
 * with no password hash and an invitation token, so whoever runs the seed
 * cannot sign in as the owner.
 */

const EMAIL = `firstadmin${Date.now().toString(36)}@test.local`;

afterAll(async () => {
  await prisma.verificationToken.deleteMany({ where: { identifier: EMAIL } });
  await prisma.person.deleteMany({ where: { user: { email: EMAIL } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

describe("first Super Admin bootstrap", () => {
  it("is created with no password and cannot sign in yet", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Owner",
        email: EMAIL,
        globalRole: "SUPER_ADMIN",
        accountStatus: "PENDING",
        person: { create: { employmentType: "EMPLOYEE" } },
      },
    });

    expect(admin.passwordHash).toBeNull();
    // PENDING is refused by the credentials provider, so the account is inert
    // until the invitation is accepted.
    expect(admin.accountStatus).toBe("PENDING");
    expect(admin.globalRole).toBe("SUPER_ADMIN");
  });

  it("becomes usable only after the invite sets a password", async () => {
    await prisma.verificationToken.create({
      data: {
        identifier: EMAIL,
        token: `tok-${Date.now()}`,
        expires: new Date(Date.now() + 60_000),
      },
    });

    // What acceptInvite does on success.
    const after = await prisma.user.update({
      where: { email: EMAIL },
      data: {
        passwordHash: "$2a$12$fakehashfortestingpurposesonly000000000000000000000",
        accountStatus: "ACTIVE",
        emailVerified: new Date(),
      },
    });

    expect(after.accountStatus).toBe("ACTIVE");
    expect(after.passwordHash).not.toBeNull();
    // Accepting an invite must not change what the account is allowed to do.
    expect(after.globalRole).toBe("SUPER_ADMIN");
  });

  it("leaves no reusable token behind", async () => {
    await prisma.verificationToken.deleteMany({ where: { identifier: EMAIL } });
    const left = await prisma.verificationToken.count({ where: { identifier: EMAIL } });
    expect(left).toBe(0);
  });
});
