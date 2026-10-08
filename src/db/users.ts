import { db } from './index.ts';
import { users } from './schema.ts';
import { eq } from 'drizzle-orm';

export async function getOrCreateUser(uid: string, email: string, name?: string) {
  const result = await db.insert(users)
    .values({
      id: uid,
      uid,
      email,
      name: name || email.split('@')[0],
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: {
        email,
        ...(name ? { name } : {}),
      },
    })
    .returning();

  return result[0];
}

export async function getUsers() {
  try {
    return await db.select().from(users);
  } catch (error) {
    console.error("Database query failed:", error);
    throw new Error("Database query failed. Please try again later.", { cause: error });
  }
}
