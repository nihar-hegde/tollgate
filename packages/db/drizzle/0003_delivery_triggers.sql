-- deliveries: completed once, pending → settled or failed (the CHECKs in 0002
-- require the matching tx_hash, failure and completed_at). Nothing else
-- changes, and nothing is deleted. Hand-written; ADR 0005.
CREATE FUNCTION deliveries_complete_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'pending'
     AND NEW.status IN ('settled', 'failed')
     AND to_jsonb(NEW) - 'status' - 'tx_hash' - 'payer' - 'failure' - 'completed_at'
       = to_jsonb(OLD) - 'status' - 'tx_hash' - 'payer' - 'failure' - 'completed_at'
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'delivery % is already completed or the change is not a completion', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER deliveries_complete_once
  BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION deliveries_complete_once();
--> statement-breakpoint
CREATE TRIGGER deliveries_no_delete
  BEFORE DELETE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION reject_change();
