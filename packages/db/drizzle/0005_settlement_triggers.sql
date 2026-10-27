-- settlements: append-only, like decisions. They copy the chain, so nothing
-- here is ever corrected in place. Hand-written; ADR 0007.
CREATE TRIGGER settlements_append_only
  BEFORE UPDATE OR DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER settlements_no_truncate
  BEFORE TRUNCATE ON settlements
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
