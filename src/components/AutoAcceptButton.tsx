import { useEffect, useState } from "react";
import {
  getAutoAccept,
  setAutoAccept,
  clearAutoAccept,
} from "../supabase/autoAccept/autoAccept";
import type { Offer } from "../types/offer";
import type { AutoAccept } from "../types/autoAccept";
import AutoAcceptModal from "./AutoAcceptModal";
import s from "../styles/dashboard.module.css";

interface Props {
  offer: Offer;
  // Preloaded rule (e.g. the dashboard batch-fetches all rules at once). When
  // omitted, the button loads its own rule — used on the single-offer page.
  rule?: AutoAccept | null;
  // Smaller pill to match the dense dashboard cards (the offer page uses the
  // default size).
  compact?: boolean;
}

// The "Auto accept" pill + its modal, with all the save/turn-off wiring. Shared
// by the offer detail page and each dashboard card so the behaviour lives in one
// place. Stops click propagation so it works inside a clickable card.
export default function AutoAcceptButton({ offer, rule, compact }: Props) {
  const [autoAccept, setAutoAcceptState] = useState<AutoAccept | null>(
    rule ?? null,
  );
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Self-load only when the parent didn't preload the rule.
  useEffect(() => {
    if (rule !== undefined) return;
    getAutoAccept(offer.id).then(setAutoAcceptState).catch(console.error);
  }, [offer.id, rule]);

  // Sync when a preloaded rule arrives/changes (the parent's batch fetch is async).
  useEffect(() => {
    if (rule !== undefined) setAutoAcceptState(rule);
  }, [rule]);

  async function handleSave(quantity: number, avgPriceLamports: number) {
    setSaving(true);
    try {
      await setAutoAccept(offer.id, quantity, avgPriceLamports);
      setAutoAcceptState(await getAutoAccept(offer.id));
      setOpen(false);
    } catch (err) {
      console.error("Failed to save auto accept", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleTurnOff() {
    setSaving(true);
    try {
      await clearAutoAccept(offer.id);
      setAutoAcceptState(null);
      setOpen(false);
    } catch (err) {
      console.error("Failed to turn off auto accept", err);
    } finally {
      setSaving(false);
    }
  }

  const armed = autoAccept != null && !autoAccept.triggered_at;

  return (
    <>
      <button
        className={`${s.autoAcceptBtn} ${compact ? s.autoAcceptBtnCompact : ""} ${armed ? s.autoAcceptBtnOn : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {armed ? "Auto accept: on" : "Auto accept"}
      </button>
      {open && (
        <AutoAcceptModal
          onClose={() => setOpen(false)}
          onSave={handleSave}
          onTurnOff={handleTurnOff}
          saving={saving}
          chain={offer.chain}
          existing={autoAccept}
        />
      )}
    </>
  );
}
