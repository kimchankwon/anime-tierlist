import { Id } from "../_generated/dataModel";

/** The public shape of a user shown in a "view someone else's list" picker. */
export function personFromUser(
  user: { name?: string; email?: string; image?: string } | null,
  userId: Id<"users">,
  isMe: boolean,
  updatedAt: number,
) {
  return {
    userId,
    name: user?.name?.trim() || user?.email?.split("@")[0] || "Anonymous",
    image: user?.image ?? null,
    isMe,
    updatedAt,
  };
}
