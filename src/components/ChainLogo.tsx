import suiWordmark from "../assets/sui.svg";
import solanaWordmark from "../assets/solana.svg";
import s from "../styles/dashboard.module.css";

// Brand wordmark for a chain, keyed off an offer/transaction's `chain` field.
// Sui's white wordmark sits on its light-blue brand chip; Solana's gradient
// wordmark stands alone on the dark surface.
export default function ChainLogo({ chain }: { chain: "sui" | "solana" }) {
  if (chain === "sui") {
    return (
      <img
        src={suiWordmark}
        alt="Sui"
        className={`${s.chainLogoImg} ${s.chainLogoSui}`}
      />
    );
  }
  return <img src={solanaWordmark} alt="Solana" className={s.chainLogoImg} />;
}
