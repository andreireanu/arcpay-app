import { supabase } from "../client";
import { getRegisteredWallet } from "./sellers";

export function waitForRegistration(userId: string): {
  promise: Promise<void>;
  cancel: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  const channel = supabase
    .channel("registration")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "qr_generator_sellers",
        filter: `user_id=eq.${userId}`,
      },
      () => {
        channel.unsubscribe();
        resolve();
      },
    )
    .subscribe();

  // Guard against race: webhook may have written the row before the listener subscribed
  getRegisteredWallet(userId)
    .then((exists) => {
      if (exists) {
        channel.unsubscribe();
        resolve();
      }
    })
    .catch(() => {});

  return {
    promise,
    cancel: () => channel.unsubscribe(),
  };
}
