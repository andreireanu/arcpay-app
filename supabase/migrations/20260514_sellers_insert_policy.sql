CREATE POLICY "users can insert own seller record"
  ON sellers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
