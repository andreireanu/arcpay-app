ALTER TABLE qr_transactions
  ADD CONSTRAINT qr_transactions_tx_signature_key UNIQUE (tx_signature);
