-- Rules a CHECK constraint can't express, because they compare a row with its
-- previous version. Hand-written; ADR 0003. Every rejection uses SQLSTATE
-- 23001 (restrict_violation) so callers can recognise it.

-- Used for DELETE, TRUNCATE, and UPDATE where nothing may change.
CREATE FUNCTION reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

-- decisions: append-only. Corrections are new rows.
CREATE TRIGGER decisions_append_only
  BEFORE UPDATE OR DELETE ON decisions
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER decisions_no_truncate
  BEFORE TRUNCATE ON decisions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
--> statement-breakpoint

-- mandates: the one allowed change is active → revoked (with revoked_at set,
-- which a CHECK enforces). Every other column must stay as it was. Comparing
-- the rows as JSON means a column added later is protected automatically.
CREATE FUNCTION mandates_revoke_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'active'
     AND NEW.status = 'revoked'
     AND to_jsonb(NEW) - 'status' - 'revoked_at' = to_jsonb(OLD) - 'status' - 'revoked_at'
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'mandate % can only be revoked, not edited', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mandates_revoke_only
  BEFORE UPDATE ON mandates
  FOR EACH ROW EXECUTE FUNCTION mandates_revoke_only();
--> statement-breakpoint
CREATE TRIGGER mandates_no_delete
  BEFORE DELETE ON mandates
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint

-- reviews: resolved once, pending → approved or denied (with resolved_at set,
-- which a CHECK enforces). Nothing else changes, and nothing is deleted.
CREATE FUNCTION reviews_resolve_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'pending'
     AND NEW.status IN ('approved', 'denied')
     AND to_jsonb(NEW) - 'status' - 'resolved_at' = to_jsonb(OLD) - 'status' - 'resolved_at'
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'review % is already resolved or the change is not a resolution', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reviews_resolve_once
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION reviews_resolve_once();
--> statement-breakpoint
CREATE TRIGGER reviews_no_delete
  BEFORE DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION reject_change();
